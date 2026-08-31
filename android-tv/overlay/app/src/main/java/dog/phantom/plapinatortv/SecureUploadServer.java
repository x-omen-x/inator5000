package dog.phantom.plapinatortv;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLServerSocketFactory;

import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x509.BasicConstraints;
import org.bouncycastle.asn1.x509.ExtendedKeyUsage;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.GeneralName;
import org.bouncycastle.asn1.x509.GeneralNames;
import org.bouncycastle.asn1.x509.KeyPurposeId;
import org.bouncycastle.asn1.x509.KeyUsage;
import org.bouncycastle.cert.X509v3CertificateBuilder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509ExtensionUtils;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;

final class SecureUploadServer {
    private static final String KEY_ALIAS = "plapinator-tv-local-tls-v3";
    private static final char[] KEY_PASSWORD = "local-session-only".toCharArray();
    private static final long HEADER_LIMIT = 32 * 1024;
    private static final long FILE_LIMIT = 6L * 1024L * 1024L * 1024L;
    private static final int MAX_WRONG_PINS_PER_DEVICE = 6;

    static final class UploadedFile {
        final String id;
        final String originalName;
        final String mimeType;
        final String role;
        final File file;

        UploadedFile(String id, String originalName, String mimeType, String role, File file) {
            this.id = id;
            this.originalName = originalName;
            this.mimeType = mimeType;
            this.role = role;
            this.file = file;
        }
    }

    static final class Session {
        final List<String> secureUrls;
        final List<String> compatibilityUrls;
        final String pin;
        final String fingerprint;

        Session(List<String> secureUrls, List<String> compatibilityUrls,
                String pin, String fingerprint) {
            this.secureUrls = secureUrls;
            this.compatibilityUrls = compatibilityUrls;
            this.pin = pin;
            this.fingerprint = fingerprint;
        }
    }

    private final Context context;
    private final File uploadDir;
    private final Consumer<List<UploadedFile>> listener;
    private final ExecutorService workers = Executors.newFixedThreadPool(6);
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final SecureRandom random = new SecureRandom();
    private final Map<String, AtomicInteger> wrongPins = new ConcurrentHashMap<>();
    private volatile boolean running;
    private SSLServerSocket secureServerSocket;
    private ServerSocket compatibilityServerSocket;
    private String pin;
    private String fingerprint;

    SecureUploadServer(Context context, File uploadDir, Consumer<List<UploadedFile>> listener) {
        this.context = context.getApplicationContext();
        this.uploadDir = uploadDir;
        this.listener = listener;
    }

    synchronized Session start() throws Exception {
        if (running) throw new IllegalStateException("Receiver is already running.");
        if (!uploadDir.exists() && !uploadDir.mkdirs()) throw new IOException("Private storage is unavailable.");

        List<String> addresses = privateIpv4Addresses(context);
        KeyStore keyStore = createSessionKey(addresses);
        Certificate certificate = keyStore.getCertificate(KEY_ALIAS);
        fingerprint = fingerprint(certificate.getEncoded());

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(keyStore, KEY_PASSWORD);
        SSLContext ssl = SSLContext.getInstance("TLS");
        ssl.init(kmf.getKeyManagers(), null, random);
        SSLServerSocketFactory factory = ssl.getServerSocketFactory();
        secureServerSocket = (SSLServerSocket) factory.createServerSocket(0);
        compatibilityServerSocket = new ServerSocket(0);

        pin = String.format(Locale.US, "%06d", random.nextInt(1_000_000));
        running = true;
        workers.execute(() -> acceptLoop(secureServerSocket, true));
        workers.execute(() -> acceptLoop(compatibilityServerSocket, false));
        timer.schedule(this::stop, 15, TimeUnit.MINUTES);

        List<String> secureUrls = new ArrayList<>();
        List<String> compatibilityUrls = new ArrayList<>();
        for (String address : addresses) {
            secureUrls.add("https://" + address + ":" + secureServerSocket.getLocalPort());
            compatibilityUrls.add("http://" + address + ":" + compatibilityServerSocket.getLocalPort());
        }
        return new Session(secureUrls, compatibilityUrls, pin, fingerprint);
    }

    synchronized void stop() {
        running = false;
        try {
            if (secureServerSocket != null) secureServerSocket.close();
        } catch (IOException ignored) {}
        try {
            if (compatibilityServerSocket != null) compatibilityServerSocket.close();
        } catch (IOException ignored) {}
        workers.shutdownNow();
        timer.shutdownNow();
    }

    private void acceptLoop(ServerSocket listeningSocket, boolean secure) {
        while (running) {
            try {
                Socket socket = listeningSocket.accept();
                if (!isPrivate(socket.getInetAddress())) {
                    socket.close();
                    continue;
                }
                socket.setSoTimeout(60_000);
                workers.execute(() -> handle(socket, secure));
            } catch (IOException error) {
                if (running) {
                    // Keep the other listener alive if only one local transport failed.
                    try { listeningSocket.close(); } catch (IOException ignored) {}
                }
                return;
            }
        }
    }

    private void handle(Socket socket, boolean secure) {
        try (socket;
             BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(socket.getOutputStream())) {
            Request request = readRequest(input);
            if (request == null) return;
            if ("GET".equals(request.method) && ("/".equals(request.path) || "/receive".equals(request.path))) {
                send(output, 200, "text/html; charset=utf-8", uploadPage(secure));
                return;
            }
            if ("GET".equals(request.method) && "/health".equals(request.path)) {
                send(output, 200, "application/json", "{\"ok\":true}");
                return;
            }
            if ("POST".equals(request.method) && "/upload".equals(request.path)) {
                receiveUpload(input, output, request, socket.getInetAddress());
                return;
            }
            send(output, 404, "text/plain; charset=utf-8", "Not found");
        } catch (Exception ignored) {
            // A dropped sender must never bring down the TV player.
        }
    }

    private void receiveUpload(InputStream input, OutputStream output, Request request,
                               InetAddress senderAddress) throws Exception {
        String sender = senderAddress == null ? "unknown" : senderAddress.getHostAddress();
        AtomicInteger failures = wrongPins.computeIfAbsent(sender, ignored -> new AtomicInteger());
        if (failures.get() >= MAX_WRONG_PINS_PER_DEVICE) {
            discardSmallBody(input, request);
            send(output, 429, "application/json", "{\"ok\":false,\"error\":\"Too many wrong PIN attempts. Restart Receive on the TV.\"}");
            return;
        }
        String suppliedPin = request.headers.getOrDefault("x-plapinator-pin", "");
        if (!MessageDigest.isEqual(pin.getBytes(StandardCharsets.UTF_8), suppliedPin.getBytes(StandardCharsets.UTF_8))) {
            failures.incrementAndGet();
            discardSmallBody(input, request);
            send(output, 403, "application/json", "{\"ok\":false,\"error\":\"Wrong PIN\"}");
            return;
        }
        wrongPins.remove(sender);

        String role = request.headers.getOrDefault("x-plapinator-role", "slides").toLowerCase(Locale.US);
        if (!role.matches("slides|audio|overlay")) role = "slides";
        String original = decodeHeaderName(request.headers.getOrDefault("x-plapinator-name", "media"));
        String safeName = safeName(original);
        String mime = request.headers.getOrDefault("content-type", "application/octet-stream").split(";", 2)[0].trim();
        String id = UUID.randomUUID().toString();
        File target = new File(uploadDir, id + "-" + safeName);

        long available = uploadDir.getUsableSpace();
        long declared = request.contentLength;
        if (declared > FILE_LIMIT || (declared > 0 && declared + 64L * 1024L * 1024L > available)) {
            send(output, 413, "application/json", "{\"ok\":false,\"error\":\"File is too large for TV storage\"}");
            return;
        }

        try (OutputStream fileOut = new BufferedOutputStream(new FileOutputStream(target))) {
            if (request.chunked) copyChunked(input, fileOut, Math.min(FILE_LIMIT, Math.max(0, available - 64L * 1024L * 1024L)));
            else copyFixed(input, fileOut, declared, Math.min(FILE_LIMIT, Math.max(0, available - 64L * 1024L * 1024L)));
        } catch (Exception error) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw error;
        }

        UploadedFile uploaded = new UploadedFile(id, original, mime, role, target);
        listener.accept(Collections.singletonList(uploaded));
        send(output, 200, "application/json", "{\"ok\":true}");
    }

    private void copyFixed(InputStream in, OutputStream out, long length, long max) throws IOException {
        if (length < 0) throw new IOException("Missing upload length.");
        if (length > max) throw new IOException("Upload exceeds available storage.");
        byte[] buffer = new byte[64 * 1024];
        long remaining = length;
        while (remaining > 0) {
            int read = in.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (read < 0) throw new EOFException("Upload ended early.");
            out.write(buffer, 0, read);
            remaining -= read;
        }
    }

    private void copyChunked(InputStream in, OutputStream out, long max) throws IOException {
        long total = 0;
        while (true) {
            String line = readAsciiLine(in, 128);
            int separator = line.indexOf(';');
            String sizeText = (separator >= 0 ? line.substring(0, separator) : line).trim();
            long size;
            try {
                size = Long.parseLong(sizeText, 16);
            } catch (NumberFormatException error) {
                throw new IOException("Invalid upload framing.");
            }
            if (size == 0) {
                while (!readAsciiLine(in, 4096).isEmpty()) {}
                return;
            }
            total += size;
            if (total > max) throw new IOException("Upload exceeds available storage.");
            copyFixed(in, out, size, max);
            if (!readAsciiLine(in, 4).isEmpty()) throw new IOException("Invalid chunk terminator.");
        }
    }

    private void discardSmallBody(InputStream input, Request request) {
        try {
            if (!request.chunked && request.contentLength >= 0 && request.contentLength <= 4096) {
                copyFixed(input, new OutputStream() {
                    @Override public void write(int ignored) {}
                    @Override public void write(byte[] bytes, int offset, int length) {}
                }, request.contentLength, 4096);
            }
        } catch (Exception ignored) {}
    }

    private Request readRequest(InputStream input) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int matched = 0;
        while (header.size() < HEADER_LIMIT) {
            int value = input.read();
            if (value < 0) return null;
            header.write(value);
            int expected = switch (matched) { case 0, 2 -> '\r'; default -> '\n'; };
            if (value == expected) matched++; else matched = value == '\r' ? 1 : 0;
            if (matched == 4) break;
        }
        if (matched != 4) throw new IOException("Header too large.");
        String text = header.toString(StandardCharsets.ISO_8859_1);
        String[] lines = text.split("\\r\\n");
        if (lines.length == 0) throw new IOException("Missing request line.");
        String[] first = lines[0].split(" ");
        if (first.length < 2) throw new IOException("Bad request line.");
        String rawPath = first[1];
        int query = rawPath.indexOf('?');
        String path = query >= 0 ? rawPath.substring(0, query) : rawPath;
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon <= 0) continue;
            headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.US), lines[i].substring(colon + 1).trim());
        }
        long length = -1;
        if (headers.containsKey("content-length")) {
            try { length = Long.parseLong(headers.get("content-length")); } catch (NumberFormatException ignored) {}
        }
        boolean chunked = headers.getOrDefault("transfer-encoding", "").toLowerCase(Locale.US).contains("chunked");
        return new Request(first[0].toUpperCase(Locale.US), path, headers, length, chunked);
    }

    private void send(OutputStream out, int status, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String label = switch (status) {
            case 200 -> "OK";
            case 403 -> "Forbidden";
            case 404 -> "Not Found";
            case 413 -> "Payload Too Large";
            case 429 -> "Too Many Requests";
            default -> "Error";
        };
        String headers = "HTTP/1.1 " + status + " " + label + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Cache-Control: no-store, max-age=0\r\n"
                + "Content-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'\r\n"
                + "Referrer-Policy: no-referrer\r\n"
                + "X-Content-Type-Options: nosniff\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        out.write(bytes);
        out.flush();
    }

    private String uploadPage(boolean secure) {
        String connectionNotice = secure
                ? "<p><b>SECURE LOCAL LINK</b> · Files use TLS directly between this device and your TV. No cloud service is contacted.</p>"
                    + "<p><small>TV certificate fingerprint: <b>" + fingerprint + "</b></small></p>"
                : "<div class=warning><b>SAFARI COMPATIBILITY LINK</b><br>This never contacts a cloud service, but it relies on your private WPA2/WPA3 home Wi-Fi for transport protection instead of a browser certificate. Use it only on your own trusted home network.</div>";
        return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<title>Plapinator TV · Private Receiver</title><style>"
                + ":root{color-scheme:dark}body{margin:0;background:#020702;color:#dfffe5;font:16px system-ui;padding:24px}"
                + "main{max-width:680px;margin:auto}.card{border:1px solid #275f31;background:#071007;border-radius:16px;padding:18px;margin:14px 0}"
                + ".warning{border:1px solid #d6a229;background:#211803;color:#ffe6a6;border-radius:12px;padding:14px;line-height:1.45}"
                + "h1,h2{color:#6cff87}input,button{font:inherit}input[type=password]{width:10em;background:#000;color:#fff;border:1px solid #4dff70;border-radius:9px;padding:12px}"
                + "input[type=file]{display:block;margin:12px 0;max-width:100%}button{background:#39ff6a;color:#001604;border:0;border-radius:10px;padding:12px 16px;font-weight:800}"
                + "small,#status{color:#9bcaa4}.bar{height:7px;background:#142817;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#39ff6a}"
                + "</style></head><body><main><h1>Omen's Plapinator TV</h1>"
                + "<p>This page is coming directly from your TV. Files go into the app's private storage and are never uploaded to a cloud service.</p>"
                + connectionNotice
                + "<div class=card><label>PIN shown on TV<br><input id=pin type=password inputmode=numeric maxlength=6 autocomplete=one-time-code></label></div>"
                + picker("slides", "Slideshow media", "image/*,video/*", true)
                + picker("audio", "Audio tracks", "audio/*,.m4a,.mp3,.wav,.aac,.ogg,.flac", true)
                + picker("overlay", "Overlay video", "video/*", false)
                + "<div class=card><div class=bar><i id=progress></i></div><p id=status>Ready · receiver closes automatically after 15 minutes.</p></div>"
                + "<script>const $=s=>document.querySelector(s);async function send(role,id){const p=$('#pin').value.trim();if(!/^\\d{6}$/.test(p)){status.textContent='Enter the six-digit TV PIN first.';return}"
                + "const files=[...$('#'+id).files];if(!files.length){status.textContent='Choose at least one file.';return}"
                + "for(let n=0;n<files.length;n++){const f=files[n];status.textContent='Sending '+f.name+' · '+(n+1)+'/'+files.length;progress.style.width=((n/files.length)*100)+'%';"
                + "const r=await fetch('/upload',{method:'POST',headers:{'Content-Type':f.type||'application/octet-stream','X-Plapinator-PIN':p,'X-Plapinator-Role':role,'X-Plapinator-Name':encodeURIComponent(f.name)},body:f});"
                + "const j=await r.json().catch(()=>({ok:false,error:'Transfer failed'}));if(!r.ok||!j.ok){status.textContent=j.error||'Transfer failed';return}}progress.style.width='100%';status.textContent='Done · files are available on the TV.'}"
                + "</script></main></body></html>";
    }

    private String picker(String role, String label, String accept, boolean multiple) {
        String id = "f_" + role;
        return "<section class=card><h2>" + label + "</h2><input id=" + id + " type=file accept='" + accept + "' "
                + (multiple ? "multiple" : "") + "><button onclick=\"send('" + role + "','" + id + "')\">Send to TV</button></section>";
    }

    private KeyStore createSessionKey(List<String> addresses) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048, random);
        KeyPair pair = generator.generateKeyPair();

        long now = System.currentTimeMillis();
        Date notBefore = new Date(now - TimeUnit.DAYS.toMillis(1));
        Date notAfter = new Date(now + TimeUnit.DAYS.toMillis(180));
        BigInteger serial = new BigInteger(120, random).abs();
        X500Name name = new X500Name("CN=" + addresses.get(0));
        X509v3CertificateBuilder builder = new JcaX509v3CertificateBuilder(
                name, serial, notBefore, notAfter, name, pair.getPublic());
        JcaX509ExtensionUtils extensions = new JcaX509ExtensionUtils();
        builder.addExtension(Extension.subjectKeyIdentifier, false,
                extensions.createSubjectKeyIdentifier(pair.getPublic()));
        builder.addExtension(Extension.authorityKeyIdentifier, false,
                extensions.createAuthorityKeyIdentifier(pair.getPublic()));
        GeneralName[] alternativeNames = new GeneralName[addresses.size()];
        for (int i = 0; i < addresses.size(); i++) {
            alternativeNames[i] = new GeneralName(GeneralName.iPAddress, addresses.get(i));
        }
        builder.addExtension(Extension.subjectAlternativeName, false,
                new GeneralNames(alternativeNames));
        builder.addExtension(Extension.basicConstraints, true, new BasicConstraints(false));
        builder.addExtension(Extension.keyUsage, true,
                new KeyUsage(KeyUsage.digitalSignature | KeyUsage.keyEncipherment));
        builder.addExtension(Extension.extendedKeyUsage, false,
                new ExtendedKeyUsage(KeyPurposeId.id_kp_serverAuth));

        BouncyCastleProvider provider = new BouncyCastleProvider();
        ContentSigner signer = new JcaContentSignerBuilder("SHA256withRSA")
                .setProvider(provider).build(pair.getPrivate());
        X509Certificate certificate = new JcaX509CertificateConverter()
                .setProvider(provider).getCertificate(builder.build(signer));
        certificate.checkValidity(new Date());
        certificate.verify(pair.getPublic());

        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        keyStore.load(null, KEY_PASSWORD);
        keyStore.setKeyEntry(KEY_ALIAS, pair.getPrivate(), KEY_PASSWORD,
                new Certificate[]{certificate});
        return keyStore;
    }

    private static List<String> privateIpv4Addresses(Context context) throws Exception {
        Set<String> ordered = new LinkedHashSet<>();
        List<String> linkLocal = new ArrayList<>();
        ConnectivityManager connectivity =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity != null) {
            Network active = connectivity.getActiveNetwork();
            LinkProperties links = active == null ? null : connectivity.getLinkProperties(active);
            if (links != null) {
                for (LinkAddress link : links.getLinkAddresses()) {
                    InetAddress address = link.getAddress();
                    if (address instanceof Inet4Address && isPrivate(address)) {
                        if (address.isLinkLocalAddress()) linkLocal.add(address.getHostAddress());
                        else ordered.add(address.getHostAddress());
                    }
                }
            }
        }

        Map<String, String> siteLocal = new LinkedHashMap<>();
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback() || network.isVirtual()) continue;
            String interfaceName = network.getName() == null ? "" : network.getName().toLowerCase(Locale.US);
            if (interfaceName.startsWith("tun") || interfaceName.startsWith("vpn")
                    || interfaceName.startsWith("dummy") || interfaceName.contains("p2p")) continue;
            for (InetAddress address : Collections.list(network.getInetAddresses())) {
                if (!(address instanceof Inet4Address) || !isPrivate(address)) continue;
                String value = address.getHostAddress();
                if (address.isLinkLocalAddress()) linkLocal.add(value);
                else siteLocal.putIfAbsent(value, interfaceName);
            }
        }
        ordered.addAll(siteLocal.keySet());
        if (ordered.isEmpty()) ordered.addAll(linkLocal);
        if (!ordered.isEmpty()) return new ArrayList<>(ordered);
        throw new IOException("Connect the TV to Wi-Fi or Ethernet first.");
    }

    private static boolean isPrivate(InetAddress address) {
        if (address == null) return false;
        byte[] raw = address.getAddress();
        if (raw.length != 4) return address.isLoopbackAddress() || address.isSiteLocalAddress() || address.isLinkLocalAddress();
        int a = raw[0] & 0xff;
        int b = raw[1] & 0xff;
        return a == 10 || a == 127 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
    }

    private static String fingerprint(byte[] certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < digest.length; i++) {
            if (i > 0) out.append(i % 8 == 0 ? " · " : ":");
            out.append(String.format(Locale.US, "%02X", digest[i]));
        }
        return out.toString();
    }

    private static String decodeHeaderName(String value) {
        try { return java.net.URLDecoder.decode(value, StandardCharsets.UTF_8.name()); }
        catch (Exception ignored) { return value; }
    }

    private static String safeName(String value) {
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
                .replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]", "_")
                .replaceAll("\\s+", " ").trim();
        if (normalized.isEmpty()) normalized = "media";
        if (normalized.length() > 140) normalized = normalized.substring(normalized.length() - 140);
        return normalized;
    }

    private static String readAsciiLine(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int previous = -1;
        while (out.size() <= limit) {
            int value = input.read();
            if (value < 0) throw new EOFException();
            if (previous == '\r' && value == '\n') {
                byte[] bytes = out.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.ISO_8859_1);
            }
            out.write(value);
            previous = value;
        }
        throw new IOException("Line too long.");
    }

    private record Request(String method, String path, Map<String, String> headers,
                           long contentLength, boolean chunked) {}
}

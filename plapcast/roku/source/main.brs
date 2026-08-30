sub Main(args as Object)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    scene = screen.CreateScene("PlapCastScene")
    if args <> invalid then scene.launchArgs = args

    input = CreateObject("roInput")
    input.SetMessagePort(port)

    screen.Show()

    while true
        msg = wait(0, port)
        kind = type(msg)
        if kind = "roSGScreenEvent" then
            if msg.IsScreenClosed() then return
        else if kind = "roInputEvent" then
            if msg.IsInput() then scene.command = msg.GetInfo()
        end if
    end while
end sub

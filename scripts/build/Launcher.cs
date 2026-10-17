// breached.exe for builds on Mozilla's own signed engine: Mozilla's files stay
// exactly as Mozilla ships them (firefox.exe included), and this starts
// firefox.exe with Breached's shell. Arguments are passed on.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class Launcher
{
    static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { sb.Append('\\', slashes * 2 + 1); }
            else { sb.Append('\\', slashes); }
            slashes = 0;
            sb.Append(c);
        }
        sb.Append('\\', slashes * 2).Append('"');
        return sb.ToString();
    }

    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        var line = new StringBuilder("-app " + Quote(Path.Combine(dir, "breached", "application.ini")));
        foreach (string arg in args) line.Append(' ').Append(Quote(arg));
        var info = new ProcessStartInfo(Path.Combine(dir, "firefox.exe"), line.ToString()) { UseShellExecute = false };
        using (var p = Process.Start(info))
        {
            // -wait-for-browser (the self-test) waits for the browser to close.
            if (Array.IndexOf(args, "-wait-for-browser") >= 0) { p.WaitForExit(); return p.ExitCode; }
        }
        return 0;
    }
}

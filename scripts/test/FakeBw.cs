// A stand-in for the Bitwarden CLI (bw.exe), for Breached's self-test.
// Master password "hunter2"; one login for any URL.
using System;

class FakeBw
{
    const string Session = "test-session-key";

    static int Main(string[] args)
    {
        string session = Environment.GetEnvironmentVariable("BW_SESSION");
        bool unlocked = session == Session;
        string cmd = args.Length > 0 ? args[0] : "";
        switch (cmd)
        {
            case "status":
                Console.Write("{\"serverUrl\":null,\"userEmail\":\"test@example.com\",\"status\":\"" + (unlocked ? "unlocked" : "locked") + "\"}");
                return 0;
            case "unlock":
                if (Environment.GetEnvironmentVariable("BW_PASSWORD") == "hunter2")
                {
                    Console.Write(Session);
                    return 0;
                }
                Console.Error.Write("Invalid master password.");
                return 1;
            case "list":
                if (!unlocked)
                {
                    Console.Error.Write("Vault is locked.");
                    return 1;
                }
                Console.Write("[{\"id\":\"1\",\"type\":1,\"name\":\"test login\",\"login\":{\"username\":\"breached-user\",\"password\":\"breached-pass\",\"totp\":null}}]");
                return 0;
            case "sync":
            case "lock":
                Console.Write("ok");
                return 0;
        }
        Console.Error.Write("unknown command " + cmd);
        return 1;
    }
}

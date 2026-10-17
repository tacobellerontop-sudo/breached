// A stand-in for the Bitwarden CLI (bw.exe), for Breached's self-test.
// Master password "hunter2"; two logins for any URL. Items made or changed
// with create/edit (passkeys) are kept in items.txt next to it, one per line.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

class FakeBw
{
    const string Session = "test-session-key";

    static readonly Dictionary<string, string> Builtin = new Dictionary<string, string>
    {
        { "1", "{\"id\":\"1\",\"type\":1,\"name\":\"test login\",\"login\":{\"username\":\"breached-user\",\"password\":\"breached-pass\",\"totp\":null}}" },
        { "2", "{\"id\":\"2\",\"type\":1,\"name\":\"second login\",\"login\":{\"username\":\"other-user\",\"password\":\"other-pass\",\"totp\":null}}" },
    };

    static string Store
    {
        get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "items.txt"); }
    }

    static List<string> Saved()
    {
        return File.Exists(Store) ? File.ReadAllLines(Store).Where(l => l.Trim() != "").ToList() : new List<string>();
    }

    static string IdOf(string json)
    {
        int start = json.IndexOf("\"id\":\"") + 6;
        return json.Substring(start, json.IndexOf('"', start) - start);
    }

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
                var all = Saved();
                foreach (var pair in Builtin)
                {
                    if (!all.Any(line => IdOf(line) == pair.Key))
                    {
                        all.Insert(0, pair.Value);
                    }
                }
                all.Sort((a, b) => string.CompareOrdinal(IdOf(a), IdOf(b)));
                Console.Write("[" + string.Join(",", all) + "]");
                return 0;
            case "get":
            {
                if (!unlocked || args.Length < 3)
                {
                    Console.Error.Write("Vault is locked.");
                    return 1;
                }
                string found = Saved().FirstOrDefault(line => IdOf(line) == args[2]);
                if (found == null && Builtin.ContainsKey(args[2]))
                {
                    found = Builtin[args[2]];
                }
                if (found == null)
                {
                    Console.Error.Write("Not found.");
                    return 1;
                }
                Console.Write(found);
                return 0;
            }
            case "create":
            case "edit":
            {
                if (!unlocked)
                {
                    Console.Error.Write("Vault is locked.");
                    return 1;
                }
                string item = Encoding.UTF8.GetString(Convert.FromBase64String(args[args.Length - 1]));
                var saved = Saved();
                string id = cmd == "edit" ? args[2] : "p" + (saved.Count + 1);
                if (cmd == "create")
                {
                    item = "{\"id\":\"" + id + "\"," + item.Substring(1);
                }
                saved.RemoveAll(line => IdOf(line) == id);
                saved.Add(item.Replace("\r", "").Replace("\n", ""));
                File.WriteAllLines(Store, saved);
                Console.Write(item);
                return 0;
            }
            case "sync":
            case "lock":
                Console.Write("ok");
                return 0;
        }
        Console.Error.Write("unknown command " + cmd);
        return 1;
    }
}

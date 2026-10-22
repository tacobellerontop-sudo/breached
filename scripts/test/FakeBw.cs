// A stand-in for the Bitwarden CLI (bw.exe), for Breached's self-test.
// Master password "hunter2"; two logins for 127.0.0.1 and Google, one for localhost, a secure note
// and a card. Items made or changed
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
        { "1", "{\"id\":\"1\",\"type\":1,\"name\":\"test login\",\"login\":{\"uris\":[{\"match\":null,\"uri\":\"http://127.0.0.1:8123/\"},{\"match\":null,\"uri\":\"https://accounts.google.com\"}],\"username\":\"breached-user\",\"password\":\"breached-pass\",\"totp\":null}}" },
        { "2", "{\"id\":\"2\",\"type\":1,\"name\":\"second login\",\"login\":{\"uris\":[{\"match\":null,\"uri\":\"http://127.0.0.1:8123/\"},{\"match\":null,\"uri\":\"https://accounts.google.com\"}],\"username\":\"other-user\",\"password\":\"other-pass\",\"totp\":null}}" },
        { "3", "{\"id\":\"3\",\"type\":1,\"name\":\"only login\",\"login\":{\"uris\":[{\"match\":1,\"uri\":\"http://localhost:8123\"}],\"username\":\"single-user\",\"password\":\"single-pass\",\"totp\":null}}" },
        { "4", "{\"id\":\"4\",\"type\":2,\"name\":\"home wifi\",\"notes\":\"network: home\\npassword: correct-horse\",\"secureNote\":{\"type\":0},\"fields\":[{\"name\":\"router pin\",\"value\":\"2468\",\"type\":1}]}" },
        { "5", "{\"id\":\"5\",\"type\":3,\"name\":\"test card\",\"card\":{\"cardholderName\":\"Test Person\",\"brand\":\"Visa\",\"number\":\"4111111111111111\",\"expMonth\":\"4\",\"expYear\":\"2030\",\"code\":\"123\"}}" },
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
            case "generate":
            {
                // Only what the mod asks for: a passphrase (--passphrase --words N --separator S).
                string[] words = { "apple", "river", "candle", "orbit", "maple", "tiger" };
                int count = 3;
                string separator = "-";
                for (int i = 1; i < args.Length - 1; i++)
                {
                    if (args[i] == "--words") count = int.Parse(args[i + 1]);
                    if (args[i] == "--separator") separator = args[i + 1];
                }
                bool capitalize = args.Contains("--capitalize");
                var random = new Random();
                var picked = Enumerable.Range(0, count).Select(n =>
                {
                    string w = words[random.Next(words.Length)];
                    return capitalize ? char.ToUpper(w[0]) + w.Substring(1) : w;
                }).ToList();
                if (args.Contains("--includeNumber"))
                {
                    picked[picked.Count - 1] += random.Next(10);
                }
                Console.Write(string.Join(separator, picked));
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

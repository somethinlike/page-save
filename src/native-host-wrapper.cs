using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class PageSaveNativeHostWrapper
{
    private const int Port = 7224;
    private const int ProbeTimeoutMs = 750;
    private const int PostLaunchProbeDelayMs = 800;

    private const uint CreateBreakawayFromJob = 0x01000000;
    private const uint CreateNewProcessGroup = 0x00000200;
    private const uint CreateNoWindow = 0x08000000;
    private const uint FileAppendData = 0x00000004;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint GenericRead = 0x80000000;
    private const uint OpenAlways = 4;
    private const uint OpenExisting = 3;
    private const int StartfUseStdHandles = 0x00000100;

    public static int Main(string[] args)
    {
        try
        {
            string requestJson = ReadNativeRequestJson(Console.OpenStandardInput());
            if (requestJson == null) return 0;

            string action = ParseAction(requestJson);
            if (action == "status")
            {
                bool listening = ProbePort();
                WriteNativeJson("{\"running\":" + JsonBool(listening) + ",\"occupied\":" + JsonBool(listening) + "}");
                return 0;
            }

            if (action == "start")
            {
                return HandleStart();
            }

            WriteNativeError("Unknown action: " + action);
            return 0;
        }
        catch (Exception ex)
        {
            WriteNativeError(ex.Message);
            return 1;
        }
    }

    private static int HandleStart()
    {
        if (ProbePort())
        {
            WriteNativeJson("{\"started\":false,\"alreadyRunning\":true,\"occupied\":true}");
            return 0;
        }

        string error;
        if (!StartServerDetached(out error))
        {
            WriteNativeJson("{\"started\":false,\"error\":\"" + EscapeJson(error) + "\"}");
            return 0;
        }

        Thread.Sleep(PostLaunchProbeDelayMs);
        bool started = ProbePort();
        WriteNativeJson("{\"started\":" + JsonBool(started) + ",\"alreadyRunning\":false}");
        return 0;
    }

    private static bool ProbePort()
    {
        using (var client = new TcpClient())
        {
            IAsyncResult result = client.BeginConnect("127.0.0.1", Port, null, null);
            bool completed = result.AsyncWaitHandle.WaitOne(ProbeTimeoutMs);
            if (!completed) return false;

            try
            {
                client.EndConnect(result);
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                result.AsyncWaitHandle.Close();
            }
        }
    }

    private static bool StartServerDetached(out string error)
    {
        error = null;

        string nodePath = FindNode();
        if (nodePath == null)
        {
            error = "node.exe not found at %USERPROFILE%\\.local\\nodejs or on PATH";
            return false;
        }

        string binDir = AppDomain.CurrentDomain.BaseDirectory;
        string root = Path.GetFullPath(Path.Combine(binDir, ".."));
        string scriptPath = Path.Combine(root, "src", "cli.ts");
        if (!File.Exists(scriptPath))
        {
            error = "cli.ts not found at " + scriptPath;
            return false;
        }

        string commandLine = QuoteArgument(nodePath) + " --experimental-strip-types " + QuoteArgument(scriptPath) + " serve";
        string outPath = Path.Combine(root, ".page-save-launched-server.out.log");
        string errPath = Path.Combine(root, ".page-save-launched-server.err.log");
        uint flags = CreateNewProcessGroup | CreateNoWindow | CreateBreakawayFromJob;

        if (TryCreateProcess(commandLine, root, outPath, errPath, flags, out error)) return true;

        string breakawayError = error;
        flags = CreateNewProcessGroup | CreateNoWindow;
        if (TryCreateProcess(commandLine, root, outPath, errPath, flags, out error)) return true;

        error = breakawayError + "; fallback without CREATE_BREAKAWAY_FROM_JOB also failed: " + error;
        return false;
    }

    private static bool TryCreateProcess(string commandLine, string workingDirectory, string outPath, string errPath, uint flags, out string error)
    {
        IntPtr stdin = IntPtr.Zero;
        IntPtr stdout = IntPtr.Zero;
        IntPtr stderr = IntPtr.Zero;

        if (!OpenServerStdHandles(outPath, errPath, out stdin, out stdout, out stderr, out error))
        {
            return false;
        }

        var startupInfo = new STARTUPINFO();
        startupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        startupInfo.dwFlags = StartfUseStdHandles;
        startupInfo.hStdInput = stdin;
        startupInfo.hStdOutput = stdout;
        startupInfo.hStdError = stderr;

        PROCESS_INFORMATION processInfo;
        var mutableCommandLine = new StringBuilder(commandLine);
        bool ok = CreateProcess(
            null,
            mutableCommandLine,
            IntPtr.Zero,
            IntPtr.Zero,
            true,
            flags,
            IntPtr.Zero,
            workingDirectory,
            ref startupInfo,
            out processInfo);

        if (!ok)
        {
            int code = Marshal.GetLastWin32Error();
            error = "CreateProcess failed (" + code + "): " + new Win32Exception(code).Message;
            CloseHandleIfOpen(stdin);
            CloseHandleIfOpen(stdout);
            CloseHandleIfOpen(stderr);
            return false;
        }

        CloseHandle(processInfo.hThread);
        CloseHandle(processInfo.hProcess);
        CloseHandleIfOpen(stdin);
        CloseHandleIfOpen(stdout);
        CloseHandleIfOpen(stderr);
        error = null;
        return true;
    }

    private static bool OpenServerStdHandles(string outPath, string errPath, out IntPtr stdin, out IntPtr stdout, out IntPtr stderr, out string error)
    {
        stdin = IntPtr.Zero;
        stdout = IntPtr.Zero;
        stderr = IntPtr.Zero;
        error = null;

        var security = new SECURITY_ATTRIBUTES();
        security.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        security.bInheritHandle = true;

        stdin = CreateFile("NUL", GenericRead, FileShareRead | FileShareWrite, ref security, OpenExisting, FileAttributeNormal, IntPtr.Zero);
        stdout = CreateFile(outPath, FileAppendData, FileShareRead | FileShareWrite, ref security, OpenAlways, FileAttributeNormal, IntPtr.Zero);
        stderr = CreateFile(errPath, FileAppendData, FileShareRead | FileShareWrite, ref security, OpenAlways, FileAttributeNormal, IntPtr.Zero);

        if (IsInvalidHandle(stdin) || IsInvalidHandle(stdout) || IsInvalidHandle(stderr))
        {
            int code = Marshal.GetLastWin32Error();
            error = "opening server stdio handles failed (" + code + "): " + new Win32Exception(code).Message;
            CloseHandleIfOpen(stdin);
            CloseHandleIfOpen(stdout);
            CloseHandleIfOpen(stderr);
            return false;
        }

        return true;
    }

    private static bool IsInvalidHandle(IntPtr handle)
    {
        return handle == IntPtr.Zero || handle == new IntPtr(-1);
    }

    private static void CloseHandleIfOpen(IntPtr handle)
    {
        if (!IsInvalidHandle(handle)) CloseHandle(handle);
    }

    private static string FindNode()
    {
        string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string portableNode = Path.Combine(profile, ".local", "nodejs", "node.exe");
        if (File.Exists(portableNode)) return portableNode;

        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string entry in path.Split(Path.PathSeparator))
        {
            if (String.IsNullOrWhiteSpace(entry)) continue;
            string candidate = Path.Combine(entry.Trim(), "node.exe");
            if (candidate.IndexOf("WindowsApps", StringComparison.OrdinalIgnoreCase) >= 0) continue;
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }

    private static string ReadNativeRequestJson(Stream stdin)
    {
        byte[] header = ReadExact(stdin, 4);
        if (header == null) return null;

        int length = BitConverter.ToInt32(header, 0);
        if (length < 0 || length > 64 * 1024 * 1024)
        {
            WriteNativeError("invalid native message length: " + length);
            return null;
        }

        byte[] payload = ReadExact(stdin, length);
        if (payload == null)
        {
            WriteNativeError("native message ended before the declared payload length");
            return null;
        }

        return Encoding.UTF8.GetString(payload);
    }

    private static byte[] ReadExact(Stream stream, int length)
    {
        byte[] buffer = new byte[length];
        int offset = 0;

        while (offset < length)
        {
            int read = stream.Read(buffer, offset, length - offset);
            if (read == 0) return null;
            offset += read;
        }

        return buffer;
    }

    private static string ParseAction(string requestJson)
    {
        string compact = requestJson.Replace(" ", "").Replace("\r", "").Replace("\n", "").Replace("\t", "");
        if (compact.IndexOf("\"action\":\"start\"", StringComparison.OrdinalIgnoreCase) >= 0) return "start";
        if (compact.IndexOf("\"action\":\"status\"", StringComparison.OrdinalIgnoreCase) >= 0) return "status";
        return "status";
    }

    private static string QuoteArgument(string value)
    {
        if (String.IsNullOrEmpty(value)) return "\"\"";

        var quoted = new StringBuilder();
        quoted.Append('"');
        int backslashes = 0;

        foreach (char c in value)
        {
            if (c == '\\')
            {
                backslashes++;
                continue;
            }

            if (c == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }

            quoted.Append('\\', backslashes);
            backslashes = 0;
            quoted.Append(c);
        }

        quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static string QuoteForCmd(string value)
    {
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private static string JsonBool(bool value)
    {
        return value ? "true" : "false";
    }

    private static void WriteNativeError(string message)
    {
        WriteNativeJson("{\"error\":\"" + EscapeJson(message) + "\"}");
    }

    private static void WriteNativeJson(string json)
    {
        byte[] payload = Encoding.UTF8.GetBytes(json);
        byte[] header = BitConverter.GetBytes(payload.Length);
        Stream stdout = Console.OpenStandardOutput();
        stdout.Write(header, 0, header.Length);
        stdout.Write(payload, 0, payload.Length);
        stdout.Flush();
    }

    private static string EscapeJson(string value)
    {
        return (value ?? "unknown error").Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        ref SECURITY_ATTRIBUTES lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }
}

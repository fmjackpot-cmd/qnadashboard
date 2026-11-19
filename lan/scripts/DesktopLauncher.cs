using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Windows.Forms;

// Only a Windows entry point: the server and its management UI remain JavaScript/HTML.
internal static class DesktopLauncher {
    [STAThread]
    static int Main(string[] args) {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "runtime", "node.exe");
            string script = Path.Combine(root, "scripts", "desktop-launch.mjs");
            if (!File.Exists(node) || !File.Exists(script)) throw new Exception("압축파일 전체를 먼저 풀고 DashboardServer.exe를 실행해주세요.");
            var info = new ProcessStartInfo(node, "\"" + script + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            using (var process = new Process { StartInfo = info }) {
                // Never show stderr, which may include environment-dependent paths or configuration.
                process.ErrorDataReceived += (sender, e) => { };
                process.Start(); process.BeginErrorReadLine();
                var line = process.StandardOutput.ReadLineAsync();
                if (!line.Wait(20000)) { process.Kill(); throw new Exception("서버 시작 시간이 초과되었습니다. 다시 실행해주세요."); }
                var result = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line.Result ?? "{}");
                if (!result.ContainsKey("ready")) throw new Exception("서버를 시작하지 못했습니다. 다른 프로그램이 8888 포트를 사용 중인지, 폴더에 쓰기 권한이 있는지 확인해주세요.");
                string url = Convert.ToString(result["url"]);
                Uri target;
                if (!Uri.TryCreate(url, UriKind.Absolute, out target) || target.Host != "127.0.0.1") throw new Exception("서버 접속 주소를 확인하지 못했습니다.");
                // --check exercises this exact launcher in the background without opening a browser.
                if (Array.IndexOf(args, "--check") < 0) {
                    try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
                    catch { MessageBox.Show("브라우저 주소창에서 다음 주소를 열어주세요.\n" + url, "예상질의 서버"); }
                } else {
                    string report = Environment.GetEnvironmentVariable("DASHBOARD_LAUNCH_REPORT");
                    if (!String.IsNullOrEmpty(report)) File.WriteAllText(report, line.Result, Encoding.UTF8);
                }
                // The launcher stays invisible until its server exits via the management page.
                process.StandardOutput.ReadToEnd(); process.WaitForExit();
                return process.ExitCode;
            }
        } catch (Exception) {
            if (Array.IndexOf(args, "--check") < 0) MessageBox.Show("서버를 시작하지 못했습니다. ZIP 전체를 쓰기 가능한 폴더에 압축 해제하고 다시 실행해주세요. 기존 서버 또는 다른 프로그램이 포트를 사용 중인지도 확인해주세요.", "예상질의 서버", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

// The Battery Hub installer window. The real work is done by the electron-builder installer,
// which is embedded here and run silently; this program is only the face of it. Keeping that
// installer untouched is what lets auto-update and winget carry on using it directly.
//
// Built by scripts/build-installer.js with the .NET Framework compiler that ships with Windows,
// so the language level is C# 5 and it needs nothing installed.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;

[assembly: AssemblyTitle("Battery Hub Installer")]
[assembly: AssemblyProduct("Battery Hub")]
// Without this the compiler records no target version and WPF falls back to old behaviour: on a
// monitor with a different display scale it keeps the first scale, and the card gets clipped.
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

namespace BatteryHubInstaller
{
    public static class Program
    {
        [STAThread]
        public static int Main()
        {
            AppContext.SetSwitch("Switch.System.Windows.DoNotScaleForDpiChanges", false);
            var app = new Application();
            var window = new InstallerWindow();
            return app.Run(window);
        }
    }

    public class InstallerWindow : Window
    {
        const double BarWidth = 240;
        // A fresh install takes a little under half a minute, but Windows gives no real progress
        // for a silent install, so the bar eases towards its end until the install reports done.
        const double ExpectedSeconds = 16;

        readonly TextBlock status;
        readonly Border fill;
        readonly Button closeButton;
        readonly FrameworkElement card;
        readonly System.Windows.Shapes.Ellipse dot;

        static Brush Color(string hex) { return (Brush)new BrushConverter().ConvertFromString(hex); }

        public InstallerWindow()
        {
            Title = "Battery Hub Installer";
            SizeToContent = SizeToContent.WidthAndHeight;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI");
            UseLayoutRounding = true;

            var image = new Image { Width = 112, Height = 112, Source = LoadArt() };
            RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.HighQuality);
            // The third light on the character's body (dark in the art) blinks while it installs.
            dot = new System.Windows.Shapes.Ellipse
            {
                Width = 3.8,
                Height = 3.8,
                Fill = Color("#67FACF"),
                Opacity = 0,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(52.6, 81.7, 0, 0),
                Effect = new DropShadowEffect { Color = Colors.White, BlurRadius = 5, ShadowDepth = 0, Opacity = 0.35 },
            };
            var art = new Grid { Width = 112, Height = 112, VerticalAlignment = VerticalAlignment.Center };
            art.Children.Add(image);
            art.Children.Add(dot);
            var bob = new TranslateTransform();
            art.RenderTransform = bob;

            var title = new TextBlock
            {
                Text = "Installing Battery Hub",
                FontSize = 20,
                FontWeight = FontWeights.SemiBold,
                Foreground = Color("#F3F4F6"),
            };
            status = new TextBlock { Text = "Getting ready", FontSize = 14, Foreground = Color("#A9AEB6"), Margin = new Thickness(0, 3, 0, 0), TextWrapping = TextWrapping.Wrap };
            fill = new Border { Width = 0, CornerRadius = new CornerRadius(3), Background = Color("#2FD5A0"), HorizontalAlignment = HorizontalAlignment.Left };
            var track = new Grid { Width = BarWidth, Height = 6, Margin = new Thickness(0, 16, 0, 0), HorizontalAlignment = HorizontalAlignment.Left };
            track.Children.Add(new Border { CornerRadius = new CornerRadius(3), Background = Color("#3A3D42") });
            track.Children.Add(fill);
            closeButton = new Button { Content = "Close", Padding = new Thickness(16, 5, 16, 6), Margin = new Thickness(0, 14, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, Visibility = Visibility.Collapsed, Background = Color("#34373C"), Foreground = Color("#F3F4F6"), BorderThickness = new Thickness(0) };
            closeButton.Click += (s, e) => Close();

            var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(26, 0, 0, 0), Width = 280 };
            text.Children.Add(title);
            text.Children.Add(status);
            text.Children.Add(track);
            text.Children.Add(closeButton);

            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(art);
            row.Children.Add(text);

            var panel = new Border
            {
                Margin = new Thickness(26),
                Padding = new Thickness(30, 24, 30, 24),
                CornerRadius = new CornerRadius(12),
                Background = Color("#202226"),
                BorderBrush = Color("#34373C"),
                BorderThickness = new Thickness(1),
                Effect = new DropShadowEffect { BlurRadius = 26, ShadowDepth = 7, Direction = 270, Opacity = 0.5 },
                Child = row,
            };
            panel.MouseLeftButtonDown += (s, e) => DragMove();
            card = panel;
            Content = panel;

            Loaded += (s, e) => { Enter(bob); Run(); };
        }

        static BitmapSource LoadArt()
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("art.png"))
            {
                var image = new BitmapImage();
                image.BeginInit();
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.StreamSource = stream;
                image.EndInit();
                image.Freeze();
                return image;
            }
        }

        void Enter(TranslateTransform bob)
        {
            var rise = new TranslateTransform(0, 16);
            card.RenderTransform = rise;
            card.Opacity = 0;
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            card.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260)));
            rise.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(16, 0, TimeSpan.FromMilliseconds(340)) { EasingFunction = ease });
            // the character breathes a little while it works
            bob.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(-2.5, 2.5, TimeSpan.FromMilliseconds(1500))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            });
            dot.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(650))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            });
        }

        // Done: the light stays on like the other two. Failed: it goes out.
        void StopDot(bool lit)
        {
            dot.BeginAnimation(OpacityProperty, new DoubleAnimation(lit ? 1 : 0, TimeSpan.FromMilliseconds(200)));
        }

        void SetProgress(double value, int ms)
        {
            var to = BarWidth * Math.Max(0, Math.Min(1, value));
            fill.BeginAnimation(WidthProperty, new DoubleAnimation(to, TimeSpan.FromMilliseconds(ms)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
        }

#if PREVIEW
        [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "SetWindowPos")]
        static extern bool Move(IntPtr h, IntPtr after, int x, int y, int w, int t, uint flags);

        [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "GetDpiForWindow")]
        static extern int Dpi(IntPtr h);
        [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "GetWindowRect")]
        static extern bool Rect(IntPtr h, out R r);
        struct R { public int Left, Top, Right, Bottom; }

        // Test build only: holds at a fixed point so the design can be checked.
        async void Run()
        {
            var args = Environment.GetCommandLineArgs();
            status.Text = args.Length > 2 && args[2] == "error" ? "Setup couldn't finish. The system cannot find the file specified. Close this and try again." : "Almost there";
            if (args.Length > 2 && args[2] == "error") closeButton.Visibility = Visibility.Visible;
            SetProgress(0.62, 200);
            if (args.Length > 3 && args[2] != "error") Move(new WindowInteropHelper(this).Handle, IntPtr.Zero, int.Parse(args[2]), int.Parse(args[3]), 0, 0, 0x15);
            await Task.Delay(1200);
            var scale = VisualTreeHelper.GetDpi(this);
            R rect; Rect(new WindowInteropHelper(this).Handle, out rect);
            File.WriteAllText(args[1] + ".txt", "real monitor dpi " + Dpi(new WindowInteropHelper(this).Handle) + ", window pixels " + (rect.Right - rect.Left) + "x" + (rect.Bottom - rect.Top) + ", wpf scale " + scale.DpiScaleX + ", window " + ActualWidth + "x" + ActualHeight + ", card " + card.ActualWidth + "x" + card.ActualHeight);
            var target = new RenderTargetBitmap((int)(ActualWidth * scale.DpiScaleX), (int)(ActualHeight * scale.DpiScaleY), scale.PixelsPerInchX, scale.PixelsPerInchY, PixelFormats.Pbgra32);
            target.Render(this);
            var png = new PngBitmapEncoder();
            png.Frames.Add(BitmapFrame.Create(target));
            using (var file = File.Create(Environment.GetCommandLineArgs()[1])) png.Save(file);
            Close();
        }
#else
        int exitCode;

        async void Run()
        {
            var payload = Path.Combine(Path.GetTempPath(), "BatteryHubSetup-" + Guid.NewGuid().ToString("N") + ".exe");
            try
            {
                SetProgress(0.04, 300);
                await Task.Run(() => Unpack(payload));
                SetProgress(0.12, 300);
                status.Text = "Copying files";
                await Task.Run(() => StopRunningApp());
                await Install(payload);
                if (exitCode != 0)
                {
                    Fail("Setup couldn't finish (code " + exitCode + "). Close this and try again.");
                    return;
                }
                SetProgress(1, 350);
                StopDot(true);
                // Started from here so the window opens even with "Start minimized" on. The install
                // has worked either way, so not finding the app isn't a failure.
                var app = FindInstalledApp();
                if (app == null)
                {
                    status.Text = "Installed. Open Battery Hub from the Start menu.";
                    closeButton.Visibility = Visibility.Visible;
                    return;
                }
                status.Text = "Ready";
                Process.Start(new ProcessStartInfo(app, "--show") { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(app) });
                await Task.Delay(1000);
                Leave();
            }
            catch (Exception e)
            {
                Fail("Setup couldn't finish. " + e.Message);
            }
            finally
            {
                try { File.Delete(payload); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }

        // Windows records where the app went: upgrades stay in the folder they were first put in.
        static string FindInstalledApp()
        {
            using (var list = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
            {
                if (list == null) return null;
                foreach (var name in list.GetSubKeyNames())
                {
                    using (var entry = list.OpenSubKey(name))
                    {
                        var title = entry == null ? null : entry.GetValue("DisplayName") as string;
                        var icon = entry == null ? null : entry.GetValue("DisplayIcon") as string;
                        if (title == null || icon == null || !title.StartsWith("Battery Hub")) continue;
                        var exe = icon.Split(',')[0].Trim('"');
                        if (File.Exists(exe)) return exe;
                    }
                }
            }
            return null;
        }

        static void Unpack(string path)
        {
            using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.exe"))
            using (var target = File.Create(path))
            {
                source.CopyTo(target, 1 << 20);
            }
        }

        // The app keeps running in the tray, and a running app can't be replaced.
        static void StopRunningApp()
        {
            foreach (var process in Process.GetProcessesByName("Battery Hub"))
            {
                try
                {
                    process.Kill();
                    process.WaitForExit(5000);
                }
                catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
            }
        }

        async Task Install(string payload)
        {
            var started = DateTime.UtcNow;
            var ticker = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            ticker.Tick += (s, e) =>
            {
                var seconds = (DateTime.UtcNow - started).TotalSeconds;
                SetProgress(0.12 + 0.83 * (1 - Math.Exp(-seconds / ExpectedSeconds)), 250);
                if (seconds > ExpectedSeconds * 0.8) status.Text = "Almost there";
            };
            ticker.Start();
            var info = new ProcessStartInfo(payload, "/S") { UseShellExecute = false, CreateNoWindow = true };
            await Task.Run(() =>
            {
                using (var process = Process.Start(info))
                {
                    process.WaitForExit();
                    exitCode = process.ExitCode;
                }
            });
            ticker.Stop();
        }

        void Fail(string message)
        {
            status.Text = message;
            status.Foreground = Color("#FF6B66");
            StopDot(false);
            closeButton.Visibility = Visibility.Visible;
        }

        void Leave()
        {
            var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(180));
            fade.Completed += (s, e) => Close();
            card.BeginAnimation(OpacityProperty, fade);
        }
#endif
    }
}

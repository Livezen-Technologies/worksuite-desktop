# The test window for check.mjs on Windows: a pad for the mouse and a text box
# for the keyboard, reporting each thing that arrives as a line of JSON.
# Coordinates are physical pixels on the virtual desktop, as the helper's are.
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -Language CSharp -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public class RcPad : Panel {
  // WinForms has no event for the sideways wheel.
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x020E) {
      int d = (short)((m.WParam.ToInt64() >> 16) & 0xFFFF);
      RcTarget.Say("{\"e\":\"wheel\",\"dir\":\"" + (d < 0 ? "left" : "right") + "\",\"dx\":" + d + ",\"dy\":0}");
    }
    base.WndProc(ref m);
  }
}

public class RcTarget : Form {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  readonly RcPad pad = new RcPad();
  readonly TextBox box = new TextBox();

  public static void Say(string json) {
    Console.Out.WriteLine(json);
    Console.Out.Flush();
  }

  // ASCII only: the console's code page would mangle anything else.
  static string Str(string s) {
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < 0x20 || c > 0x7e) b.Append("\\u").Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  static string Rect(Rectangle r) {
    return "{\"x\":" + r.X + ",\"y\":" + r.Y + ",\"width\":" + r.Width + ",\"height\":" + r.Height + "}";
  }

  static string ButtonName(MouseButtons b) {
    return b == MouseButtons.Left ? "left" : b == MouseButtons.Right ? "right" : b == MouseButtons.Middle ? "middle" : "other";
  }

  static string Flag(bool on) {
    return on ? "true" : "false";
  }

  RcTarget() {
    Text = "rc-target";
    StartPosition = FormStartPosition.Manual;
    Location = new Point(200, 150);
    ClientSize = new Size(640, 420);
    pad.SetBounds(0, 0, 640, 300);
    pad.BackColor = Color.LightSteelBlue;
    box.Multiline = true;
    box.SetBounds(0, 300, 640, 120);
    Controls.Add(pad);
    Controls.Add(box);
    pad.MouseDown += delegate(object s, MouseEventArgs e) {
      Point p = pad.PointToScreen(e.Location);
      Say("{\"e\":\"down\",\"button\":\"" + ButtonName(e.Button) + "\",\"clicks\":" + e.Clicks + ",\"x\":" + p.X + ",\"y\":" + p.Y + "}");
    };
    pad.MouseUp += delegate(object s, MouseEventArgs e) { Say("{\"e\":\"up\",\"button\":\"" + ButtonName(e.Button) + "\"}"); };
    pad.MouseMove += delegate(object s, MouseEventArgs e) {
      if (e.Button == MouseButtons.None) return;
      Point p = pad.PointToScreen(e.Location);
      Say("{\"e\":\"drag\",\"button\":\"" + ButtonName(e.Button) + "\",\"x\":" + p.X + ",\"y\":" + p.Y + "}");
    };
    MouseEventHandler wheel = delegate(object s, MouseEventArgs e) {
      Say("{\"e\":\"wheel\",\"dir\":\"" + (e.Delta < 0 ? "down" : "up") + "\",\"dx\":0,\"dy\":" + e.Delta + "}");
    };
    pad.MouseWheel += wheel;
    box.MouseWheel += wheel;
    box.KeyDown += delegate(object s, KeyEventArgs e) {
      Say("{\"e\":\"key\",\"key\":" + Str(e.KeyCode.ToString().ToLowerInvariant()) + ",\"shift\":" + Flag(e.Shift) + ",\"ctrl\":" + Flag(e.Control) + ",\"alt\":" + Flag(e.Alt) + ",\"meta\":false}");
    };
    box.TextChanged += delegate { Say("{\"e\":\"text\",\"value\":" + Str(box.Text) + "}"); };
    Shown += delegate {
      Activate();
      SetForegroundWindow(Handle);
      box.Focus();
      Say("{\"ready\":true,\"window\":\"" + Handle.ToInt64() + "\",\"frame\":" + Rect(Bounds) + ",\"pad\":" + Rect(pad.RectangleToScreen(pad.ClientRectangle)) + ",\"box\":" + Rect(box.RectangleToScreen(box.ClientRectangle)) + "}");
    };
  }

  public static void Main() {
    SetProcessDPIAware();
    Application.EnableVisualStyles();
    Application.Run(new RcTarget());
  }
}
'@
[RcTarget]::Main()

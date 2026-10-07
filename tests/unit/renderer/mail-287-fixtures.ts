/**
 * Emails as they reach the reading pane (worksuite-desktop#287): what the server sends in `body_html` for a plain-text
 * notice, a newsletter, a bank alert, Gmail and Outlook reply chains, an email with dark styles of its own and one laid
 * over background pictures.
 */

/** WordPress's update notice: plain text, which the server sends as words and <br />. */
export const WORDPRESS_PLAIN = [
  'Howdy! Some plugins have automatically updated to their latest versions on your site at https://shop.example.lk. No further action is needed on your part.',
  '',
  'These plugins are now up to date:',
  '- Akismet Anti-spam (from version 5.3 to 5.3.1) : https://wordpress.org/plugins/akismet/',
  '',
  'If you experience any issues or need support, the volunteers in the WordPress.org support forums may be able to help.',
  'https://wordpress.org/support/forums/',
  '',
  'Questions? Write to support@shop.example.lk or call +94 77 123 4567.',
  '',
  'The WordPress Team',
]
  .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
  .join('<br />\n');

/** A newsletter: a grey page, a 600px white table, a transparent PNG logo, dark text and an orange button. */
export const NEWSLETTER = `<table width="100%" bgcolor="#eeeeee" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="600" bgcolor="#ffffff" cellpadding="24" cellspacing="0" style="border:1px solid #dddddd">
<tr><td><img src="https://cdn.shop.example/logo.png" width="160" height="40" alt="Shop"></td></tr>
<tr><td><h1 style="color:#111111;font-family:Arial">Spring sale</h1><p style="color:#555555">Everything in the garden range is 20% off until Sunday.</p>
<a href="https://shop.example/sale" style="background:#e8710a;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none">Shop now</a></td></tr>
<tr><td style="background-color:#f4f4f4;color:#888888;font-size:12px">You get this because you signed up at shop.example.</td></tr>
</table></td></tr></table>`;

/** A bank alert: a dark brand header with a white logo, a red amount, a grey table and a brand button. */
export const BANK_ALERT = `<table width="100%" bgcolor="#f2f4f7"><tr><td align="center">
<table width="560" bgcolor="#ffffff" style="border:1px solid #e1e4ea">
<tr><td style="background:#0b3d91;padding:16px"><img src="https://bank.example/logo-white.png" width="120" height="32" alt="Bank"></td></tr>
<tr><td style="color:#333333;font-family:Arial;padding:20px">Dear customer, a debit of <b style="color:#c62828">LKR 12,500.00</b> was made from account ****4821 on 05/10/2026.</td></tr>
<tr><td><table width="100%"><tr><td style="color:#666666">Reference</td><td style="color:#111111">TXN 0012345678901</td></tr></table></td></tr>
<tr><td style="padding:20px"><a href="https://bank.example/app" style="background:#0b3d91;color:#ffffff;padding:10px 16px;border-radius:4px">View in the app</a></td></tr>
</table></td></tr></table>`;

/** A Gmail reply: the answer, a long signature, then the quoted email under "On … wrote:". */
export const GMAIL_REPLY = `<div dir="ltr">Thanks Nimal, Friday at 10 works for me.<br><br><div><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div>Asha Perera</div><div>Head of Sales</div><div>Livezen Technologies</div><div>No. 12, Flower Road, Colombo 07</div><div>+94 77 123 4567</div><div>www.livezen.example</div><div>This email and any files transmitted with it are confidential.</div></div></div></div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Mon, 5 Oct 2026 at 10:02, Nimal &lt;nimal@sfcl.example&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div dir="ltr">Can we meet on Friday?</div></blockquote></div>`;

/** Outlook for Windows: the answer, then a block ruled along its top with From:, then the original. */
export const OUTLOOK_REPLY = `<div class="WordSection1"><p class="MsoNormal">Sounds good, see you then.<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm"><p class="MsoNormal"><b>From:</b> Nimal &lt;nimal@sfcl.example&gt;<br><b>Sent:</b> Monday, 5 October 2026 10:02<br><b>To:</b> Asha<br><b>Subject:</b> Meeting</p></div><p class="MsoNormal">Can we meet on Friday?<o:p></o:p></p></div>`;

/** Outlook on the web: the answer, #appendonsend, a rule and #divRplyFwdMsg, then the original. */
export const OUTLOOK_WEB_REPLY = `<div style="font-family:Calibri">Booked.</div><div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri" style="font-size:11pt"><b>From:</b> Nimal<br><b>Sent:</b> Monday, October 5, 2026 10:02 AM<br><b>Subject:</b> Room</font></div><div>Could you book the room?</div>`;

/** A plain-text reply chain: the answer, a signature under "-- ", and the quote in "> " lines. */
export const PLAIN_REPLY = `Yes, Friday is fine.\n\nSee you there.\n\n-- \nAsha\n\nOn Mon, 5 Oct 2026 at 10:02, Nimal <nimal@sfcl.example> wrote:\n> Can we meet on Friday?\n> I can come to your office.\n>\n> Nimal`;

/** Outlook's plain-text reply: no "> ", the original under "-----Original Message-----". */
export const OUTLOOK_PLAIN_REPLY = `Approved.\n\n-----Original Message-----\nFrom: Nimal <nimal@sfcl.example>\nSent: Monday, October 5, 2026 10:02 AM\nTo: Asha\nSubject: Leave\n\nMay I take Friday off?`;

/** A forwarded message: nothing of the sender's own above it, so it never folds away. */
export const FORWARD_PLAIN = `---------- Forwarded message ---------\nFrom: Nimal <nimal@sfcl.example>\nDate: Mon, 5 Oct 2026\n\n> Please see the attached quote.\n> Thanks`;

/** An email with dark styles of its own: its <head> stylesheet answers prefers-color-scheme: dark. */
export const DARK_AWARE = `<html><head><meta name="color-scheme" content="light dark"><style>.card{background:#ffffff;color:#222222}@media (prefers-color-scheme: dark){.card{background:#1c1c1e !important;color:#f2f2f7 !important}}</style></head><body><div class="card" style="padding:20px">Your order has shipped.</div></body></html>`;

/** A design laid over background pictures (Outlook's VML among them): darkening it would read badly. */
export const BACKGROUND_PICTURES = `<table width="600" bgcolor="#ffffff"><tr><td background="https://cdn.example/hero.jpg" style="background-image:url('https://cdn.example/hero.jpg');color:#ffffff">Summer is here</td></tr><tr><td background="https://cdn.example/band.jpg" bgcolor="#f0e6d2" style="color:#333333">Sale on everything</td></tr></table>`;

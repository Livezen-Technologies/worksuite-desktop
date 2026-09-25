/**
 * The emoji the picker offers, each with the words it is found by, and the
 * ones this person uses most (kept on this computer only; a picker that
 * forgets them still works).
 */
export const EMOJI: ReadonlyArray<readonly [string, string]> = [
  ['😀', 'grin smile happy'], ['😃', 'smile happy joy'], ['😄', 'smile laugh happy'], ['😁', 'grin beam teeth'],
  ['😆', 'laugh squint haha'], ['😅', 'sweat laugh relief'], ['😂', 'joy tears laugh lol'], ['🤣', 'rofl rolling laugh'],
  ['🙂', 'slight smile ok'], ['🙃', 'upside down silly'], ['😉', 'wink'], ['😊', 'blush smile happy'],
  ['😇', 'angel innocent halo'], ['🥰', 'love hearts adore'], ['😍', 'heart eyes love'], ['🤩', 'star struck wow'],
  ['😘', 'kiss blow'], ['😋', 'yum tasty tongue'], ['😜', 'wink tongue crazy'], ['🤪', 'zany crazy goofy'],
  ['🤗', 'hug hugging'], ['🤭', 'oops giggle hand'], ['🤫', 'shush quiet secret'], ['🤔', 'think thinking hmm'],
  ['🤐', 'zipper mouth quiet'], ['😐', 'neutral meh'], ['😑', 'expressionless blank'], ['😶', 'no mouth silent'],
  ['😏', 'smirk'], ['🙄', 'eye roll whatever'], ['😬', 'grimace awkward'], ['😌', 'relieved calm'],
  ['😔', 'pensive sad'], ['😪', 'sleepy tired'], ['😴', 'sleep zzz tired'], ['😷', 'mask sick'],
  ['🤒', 'sick fever thermometer'], ['🤧', 'sneeze cold tissue'], ['🥵', 'hot heat sweat'], ['🥶', 'cold freezing'],
  ['🤯', 'mind blown exploding'], ['🥳', 'party celebrate'], ['😎', 'cool sunglasses'], ['🤓', 'nerd geek glasses'],
  ['😕', 'confused'], ['😟', 'worried'], ['😮', 'wow open mouth surprised'], ['😲', 'astonished shocked'],
  ['😳', 'flushed embarrassed'], ['🥺', 'pleading puppy please'], ['😢', 'cry sad tear'], ['😭', 'sob crying'],
  ['😱', 'scream fear'], ['😤', 'triumph huff steam'], ['😡', 'angry mad rage'], ['🤬', 'cursing swear'],
  ['👍', 'thumbs up like yes ok agree'], ['👎', 'thumbs down dislike no'], ['👏', 'clap applause well done'], ['🙌', 'raised hands hooray praise'],
  ['🙏', 'pray thanks please folded hands'], ['🤝', 'handshake deal agree'], ['👌', 'ok perfect'], ['✌️', 'victory peace'],
  ['🤞', 'fingers crossed luck hope'], ['🤙', 'call me shaka'], ['👋', 'wave hello hi bye'], ['✋', 'raised hand stop high five'],
  ['👉', 'point right'], ['👈', 'point left'], ['👆', 'point up'], ['👇', 'point down'],
  ['💪', 'muscle strong flex'], ['🫡', 'salute respect'], ['🫶', 'heart hands love'], ['👀', 'eyes look see watching'],
  ['🧠', 'brain smart think'], ['🙋', 'raising hand question me'], ['🤷', 'shrug dunno whatever'], ['🤦', 'facepalm'],
  ['❤️', 'heart love red'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'],
  ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['💔', 'broken heart'],
  ['💯', 'hundred perfect score'], ['🔥', 'fire hot lit'], ['✨', 'sparkles shiny new'], ['⭐', 'star favourite'],
  ['🌟', 'glowing star'], ['⚡', 'lightning zap fast'], ['💥', 'boom collision'], ['🎉', 'party tada celebrate congrats'],
  ['🎊', 'confetti celebrate'], ['🎂', 'birthday cake'], ['🎁', 'gift present'], ['🏆', 'trophy win award'],
  ['🥇', 'gold medal first'], ['🎯', 'target goal bullseye'], ['🚀', 'rocket launch ship'], ['📈', 'chart up growth'],
  ['📉', 'chart down decline'], ['📊', 'bar chart stats report'], ['💡', 'idea bulb'], ['📌', 'pin pushpin'],
  ['📎', 'paperclip attach'], ['📅', 'calendar date'], ['🗓️', 'calendar spiral schedule'], ['⏰', 'alarm clock time'],
  ['⏳', 'hourglass waiting'], ['📞', 'phone call'], ['📧', 'email mail'], ['📝', 'memo note write'],
  ['📁', 'folder file'], ['📄', 'page document'], ['🔒', 'lock secure private'], ['🔑', 'key'],
  ['💻', 'laptop computer'], ['🖥️', 'desktop computer'], ['📱', 'mobile phone'], ['🐛', 'bug'],
  ['🛠️', 'tools fix build'], ['⚙️', 'gear settings'], ['🧾', 'receipt invoice'], ['💰', 'money bag'],
  ['💸', 'money flying spend'], ['🏠', 'home house'], ['🏢', 'office building'], ['✈️', 'plane travel flight'],
  ['🚗', 'car drive'], ['☕', 'coffee tea break'], ['🍵', 'tea'], ['🍕', 'pizza food'],
  ['🍔', 'burger food'], ['🍰', 'cake dessert'], ['🍻', 'cheers beers'], ['🥂', 'cheers toast champagne'],
  ['☀️', 'sun sunny'], ['🌧️', 'rain'], ['🌈', 'rainbow'], ['🌙', 'moon night'],
  ['✅', 'check done yes tick complete'], ['☑️', 'check box ballot'], ['✔️', 'check mark'], ['❌', 'cross no wrong cancel'],
  ['❗', 'exclamation important'], ['❓', 'question'], ['⚠️', 'warning caution'], ['🚫', 'prohibited forbidden no'],
  ['🔴', 'red circle'], ['🟢', 'green circle'], ['🟡', 'yellow circle'], ['🔵', 'blue circle'],
  ['➕', 'plus add'], ['➖', 'minus'], ['🆗', 'ok button'], ['🆕', 'new'],
];

const KEY = 'ws.chat.emoji.used';
const DEFAULT_FREQUENT = ['👍', '❤️', '😂', '🙏', '🎉', '✅', '👀', '🔥', '😊', '👏', '💯', '🙌', '😅', '🤔', '👌', '🚀'];

/** Emoji whose words start with every word typed, best first. */
export function searchEmoji(q: string): string[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return EMOJI.map(([e]) => e);
  return EMOJI.filter(([, k]) => {
    const names = k.split(' ');
    return words.every((w) => names.some((n) => n.startsWith(w)));
  }).map(([e]) => e);
}

function counts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The sixteen this person uses most, topped up with common ones. */
export function frequentEmoji(): string[] {
  const used = Object.entries(counts()).sort((a, b) => b[1] - a[1]).map(([e]) => e);
  return [...new Set([...used, ...DEFAULT_FREQUENT])].slice(0, 16);
}

export function noteEmojiUsed(e: string): void {
  try {
    const c = counts();
    c[e] = (c[e] ?? 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Remembering is a convenience; the picker works without it.
  }
}

import { useState, type ChangeEvent } from 'react';
import { apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Button, Modal, TextField } from '../../components/ui';

/**
 * Add sender to contacts (ENH-MAIL-03 DMO-PPL-04): the name, job title,
 * company and phone numbers read from the signature, shown for review before
 * anything is saved. The parsing only suggests; every field can be changed
 * or cleared, and nothing is filled that the signature does not say.
 */

export interface SignatureGuess {
  name: string;
  job_title: string;
  company: string;
  mobile: string;
  office_phone: string;
  website: string;
}

const PHONE = /(?:\+|00)?\d[\d\s().-]{6,}\d/;
const LABEL = /^(?:(m|mob|mobile|cell|c)|(t|tel|phone|p|office|o|direct|d|work|w)|(f|fax))\s*[.:]?\s*/i;
const URL = /\b((?:https?:\/\/)?(?:www\.)[^\s<>]+|https?:\/\/[^\s<>]+)/i;
const SIGN_OFF = /^(?:regards|best(?: regards| wishes)?|kind regards|thanks(?: and regards| & regards)?|thank you|cheers|sincerely|yours(?: sincerely| faithfully)?|warm regards|many thanks|br)[,.!]?$/i;
const QUOTE_START = /^(?:on .+wrote:|-{2,}\s*original message\s*-{2,}|from:\s.+|_{5,}|>.*)$/i;

/** The message's own text, without what it quotes. */
function ownText(body: string): string[] {
  const lines = body.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const end = lines.findIndex((l) => QUOTE_START.test(l));
  return (end === -1 ? lines : lines.slice(0, end)).filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''));
}

/**
 * What a signature says about its writer. It looks after the sign-off (or,
 * failing that, at the last lines), starting at the line with the sender's
 * name: the lines under the name are title then company; numbers are mobile,
 * office or fax by their labels.
 */
export function parseSignature(body: string, fromName: string | null, fromEmail: string): SignatureGuess {
  const out: SignatureGuess = { name: (fromName ?? '').trim(), job_title: '', company: '', mobile: '', office_phone: '', website: '' };
  const lines = ownText(body);
  const signOff = lines.map((l) => SIGN_OFF.test(l)).lastIndexOf(true);
  let block = (signOff >= 0 ? lines.slice(signOff + 1) : lines.slice(-10)).filter(Boolean).slice(0, 10);
  const nameWords = (fromName ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const nameAt = block.findIndex((l) => nameWords.length > 0 && nameWords.every((w) => l.toLowerCase().includes(w)) && l.length <= 60);
  if (nameAt >= 0) {
    const [name, ...rest] = block[nameAt]!.split(/\s*[|•·,]\s*/);
    out.name = (name ?? '').trim() || out.name;
    block = [...(rest.length ? [rest.join(' | ')] : []), ...block.slice(nameAt + 1)];
  } else if (signOff < 0) {
    // No sign-off and no name: nothing here can be told from the body.
    block = [];
  }
  const words: string[] = [];
  for (const line of block) {
    for (const part of line.split(/\s*[|•·]\s*/)) {
      const p = part.trim();
      if (!p) continue;
      if (p.toLowerCase().includes(fromEmail.toLowerCase()) || /^\S+@\S+$/.test(p)) continue;
      const phone = PHONE.exec(p);
      if (phone && phone[0].replace(/\D/g, '').length >= 7) {
        const label = LABEL.exec(p);
        const number = phone[0].trim();
        if (label?.[3]) continue;
        if (label?.[1]) out.mobile ||= number;
        else if (label?.[2]) out.office_phone ||= number;
        else if (!out.mobile) out.mobile = number;
        else out.office_phone ||= number;
        continue;
      }
      const url = URL.exec(p);
      if (url) {
        out.website ||= url[1]!;
        continue;
      }
      if (p.length <= 60 && /\p{L}/u.test(p) && !/[{}<>]/.test(p)) words.push(p);
    }
  }
  if (nameAt >= 0) {
    out.job_title = words[0] ?? '';
    out.company = words[1] ?? '';
  }
  return out;
}

export function AddContactDialog({ guess, email, onSaved, onClose }: { guess: SignatureGuess; email: string; onSaved: () => void; onClose: () => void }) {
  const [v, setV] = useState(guess);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof SignatureGuess) => (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await apiPost('/api/contacts', {
        display_name: v.name.trim() || email,
        work_email: email,
        ...(v.job_title.trim() ? { job_title: v.job_title.trim() } : {}),
        ...(v.company.trim() ? { company: v.company.trim() } : {}),
        ...(v.mobile.trim() ? { mobile: v.mobile.trim() } : {}),
        ...(v.office_phone.trim() ? { office_phone: v.office_phone.trim() } : {}),
        ...(v.website.trim() ? { website: v.website.trim() } : {}),
      });
      toast('success', text('{name} is in your contacts.', { name: v.name.trim() || email }));
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Add to contacts')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Add contact
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[13px]">
        <p className="text-[12.5px] text-ink-3">{text('Filled in from the signature in this email — check before saving.')}</p>
        <TextField label={text('Name')} value={v.name} onChange={set('name')} />
        <TextField label={text('Email')} value={email} readOnly />
        <TextField label={text('Job title')} value={v.job_title} onChange={set('job_title')} />
        <TextField label={text('Company')} value={v.company} onChange={set('company')} />
        <TextField label={text('Mobile')} value={v.mobile} onChange={set('mobile')} />
        <TextField label={text('Office phone')} value={v.office_phone} onChange={set('office_phone')} />
        <TextField label={text('Website')} value={v.website} onChange={set('website')} />
      </div>
    </Modal>
  );
}

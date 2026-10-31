/**
 * X10 optional Hindi/Marathi labels: the app chrome — tabs, header controls, readiness —
 * speaks the family's language when English is not comfortable. Scope is honest: chrome
 * and recurring actions only; the deeper forms stay English for now and every missing
 * string falls back to English rather than showing a gap.
 */

export type Lang = 'en' | 'hi' | 'mr';

export const LANGS: readonly { readonly id: Lang; readonly label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'mr', label: 'मराठी' },
];

const STORAGE_KEY = 'utsav.lang.v1';

const EN: Readonly<Record<string, string>> = {
  'tab.events': 'All events',
  'tab.setup': 'Event',
  'tab.budget': 'Budget',
  'tab.timeline': 'Timeline',
  'tab.runsheet': 'Run sheet',
  'tab.guests': 'Guests',
  'tab.vendors': 'Vendors',
  'tab.cashflow': 'Payments',
  'tab.activity': 'Activity',
  'tab.assistant': 'Assistant',
  'header.undo': 'Undo',
  'header.redo': 'Redo',
  'header.reset': 'Reset',
  'header.exportJson': 'Export JSON',
  'header.exportCsv': 'Export CSV',
  'header.loadDemo': 'Load demo event',
  'header.resetConfirm': 'Delete every saved event',
  'header.resetCancel': 'Keep my events',
  'header.language': 'Language',
  'readiness.onTrack': 'On track',
  'readiness.atRisk': 'At risk',
  'readiness.needsAttention': 'Needs attention',
  'readiness.aria': 'Plan readiness',
  'a11y.skip': 'Skip to main content',
};

const HI: Readonly<Record<string, string>> = {
  'tab.events': 'सभी कार्यक्रम',
  'tab.setup': 'कार्यक्रम',
  'tab.budget': 'बजट',
  'tab.timeline': 'समय-सारणी',
  'tab.runsheet': 'कार्यक्रम-सूची',
  'tab.guests': 'अतिथि',
  'tab.vendors': 'विक्रेता',
  'tab.cashflow': 'भुगतान',
  'tab.activity': 'गतिविधि',
  'tab.assistant': 'सहायक',
  'header.undo': 'पूर्ववत',
  'header.redo': 'पुनः करें',
  'header.reset': 'रीसेट',
  'header.exportJson': 'JSON निर्यात',
  'header.exportCsv': 'CSV निर्यात',
  'header.loadDemo': 'डेमो कार्यक्रम लोड करें',
  'header.resetConfirm': 'सभी सहेजे कार्यक्रम हटाएँ',
  'header.resetCancel': 'मेरे कार्यक्रम रखें',
  'header.language': 'भाषा',
  'readiness.onTrack': 'सब ठीक है',
  'readiness.atRisk': 'जोखिम में',
  'readiness.needsAttention': 'ध्यान चाहिए',
  'readiness.aria': 'योजना की तैयारी',
  'a11y.skip': 'मुख्य सामग्री पर जाएँ',
};

const MR: Readonly<Record<string, string>> = {
  'tab.events': 'सर्व कार्यक्रम',
  'tab.setup': 'कार्यक्रम',
  'tab.budget': 'बजट',
  'tab.timeline': 'वेळापत्रक',
  'tab.runsheet': 'दिनक्रम',
  'tab.guests': 'पाहुणे',
  'tab.vendors': 'पुरवठादार',
  'tab.cashflow': 'देयके',
  'tab.activity': 'कार्यवाही',
  'tab.assistant': 'सहाय्यक',
  'header.undo': 'पूर्ववत',
  'header.redo': 'पुन्हा करा',
  'header.reset': 'रीसेट',
  'header.exportJson': 'JSON निर्यात',
  'header.exportCsv': 'CSV निर्यात',
  'header.loadDemo': 'नमुना कार्यक्रम भरा',
  'header.resetConfirm': 'सर्व जतन केलेले कार्यक्रम काढा',
  'header.resetCancel': 'माझे कार्यक्रम ठेवा',
  'header.language': 'भाषा',
  'readiness.onTrack': 'व्यवस्थित चालू',
  'readiness.atRisk': 'धोक्यात',
  'readiness.needsAttention': 'लक्ष द्या',
  'readiness.aria': 'योजनेची तयारी',
  'a11y.skip': 'मुख्य मजकुराकडे जा',
};

const DICTS: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { en: EN, hi: HI, mr: MR };

function isLang(value: string): value is Lang {
  return value === 'en' || value === 'hi' || value === 'mr';
}

export function loadLang(storage: Storage = window.localStorage): Lang {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return stored !== null && isLang(stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

export function storeLang(lang: Lang, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode: the choice lasts this session only */
  }
}

/** Missing strings fall back to English — never an empty label. */
export function translate(lang: Lang, key: string): string {
  return DICTS[lang][key] ?? EN[key] ?? key;
}

// Nickname safety: a word filter, and friendly random names for classrooms.

// Kept short on purpose: it catches the usual suspects, and the host can
// still remove anyone from the lobby. Matching ignores spaces, symbols and
// common letter swaps (4 for a, 3 for e, and so on).
const BLOCKED = [
  'fuck', 'fuk', 'fck', 'shit', 'cunt', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'penis', 'vagina',
  'wank', 'twat', 'slag', 'slut', 'whore', 'nigg', 'nigga', 'fag', 'retard', 'spastic', 'tits', 'boob',
  'arse', 'asshole', 'bollock', 'bellend', 'prick', 'piss', 'porn', 'sex', 'rape', 'nazi', 'hitler',
  'kkk', 'paki', 'chink', 'tranny', 'dildo', 'cum', 'jizz', 'anal', 'nonce', 'pedo', 'paedo', 'kys',
];
// Short words that are only blocked when they are the whole word, so "Scunthorpe"
// and "Dickens" are fine but "sex" on its own is not.
const WHOLE_ONLY = new Set(['dick', 'cock', 'cum', 'anal', 'sex', 'arse', 'piss', 'fag', 'tits', 'kkk', 'kys', 'prick', 'slag', 'paki', 'nazi', 'rape', 'pedo', 'nonce']);
// Real words and places that contain a blocked word.
const SAFE = ['scunthorpe', 'penistone', 'arsenal', 'shitake', 'cockburn'];

const SWAPS = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '+': 't' };

function squash(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[01!34@5$789+]/g, c => SWAPS[c]).replace(/(.)\1{2,}/g, '$1$1');
}

export function isRude(text) {
  const s = squash(text);
  let joined = s.replace(/[^a-z]/g, '');
  for (const ok of SAFE) joined = joined.split(ok).join('');
  const words = s.split(/[^a-z]+/).filter(Boolean);
  for (const w of BLOCKED) {
    if (WHOLE_ONLY.has(w)) { if (words.includes(w) || joined === w) return true; }
    else if (joined.includes(w)) return true;
  }
  return false;
}

const ADJECTIVES = ['Brave', 'Clever', 'Speedy', 'Happy', 'Sneaky', 'Mighty', 'Jolly', 'Fuzzy', 'Lucky', 'Zippy', 'Cosmic', 'Bouncy', 'Witty', 'Sunny', 'Daring', 'Gentle', 'Rapid', 'Shiny', 'Bold', 'Chilly', 'Dizzy', 'Fancy', 'Giant', 'Tiny', 'Wild', 'Noble', 'Quirky', 'Sparky', 'Turbo', 'Wise'];
const ANIMALS = ['Otter', 'Panda', 'Falcon', 'Koala', 'Tiger', 'Penguin', 'Badger', 'Dolphin', 'Fox', 'Hedgehog', 'Lemur', 'Llama', 'Moose', 'Narwhal', 'Owl', 'Puffin', 'Rabbit', 'Raccoon', 'Sloth', 'Squid', 'Toucan', 'Walrus', 'Wombat', 'Yak', 'Zebra', 'Gecko', 'Hippo', 'Jaguar', 'Kiwi', 'Mole'];

export function randomName(taken = new Set(), rand = Math.random) {
  for (let i = 0; i < 200; i++) {
    const name = `${ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)]} ${ANIMALS[Math.floor(rand() * ANIMALS.length)]}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return `Player ${Math.floor(rand() * 9000) + 1000}`;
}

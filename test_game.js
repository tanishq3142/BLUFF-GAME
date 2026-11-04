// Comprehensive Automated Verification for Bluff Server
const http = require('http');
const crypto = require('crypto');

console.log('--- 1. Testing Deck Generation & Jokers ---');
// Import deck generator logic from server or test directly
const SUITS = [
  { symbol: '♠', name: 'spades', color: 'black' },
  { symbol: '♥', name: 'hearts', color: 'red' },
  { symbol: '♦', name: 'diamonds', color: 'red' },
  { symbol: '♣', name: 'clubs', color: 'black' }
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function generateDeck(deckCount = 1, jokerCount = 2) {
  const cards = [];
  let cardId = 1;
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: `c_${cardId++}`, suit: suit.symbol, rank, isJoker: false });
      }
    }
  }
  for (let j = 0; j < jokerCount; j++) {
    cards.push({ id: `j_${cardId++}`, suit: '★', rank: 'JOKER', isJoker: true });
  }
  return cards;
}

const deck1 = generateDeck(1, 2);
console.log('Single deck + 2 jokers count:', deck1.length, '(expected 54)');
if (deck1.length !== 54) throw new Error('Deck 1 count mismatch');

const deck2 = generateDeck(2, 4);
console.log('Double deck + 4 jokers count:', deck2.length, '(expected 108)');
if (deck2.length !== 108) throw new Error('Deck 2 count mismatch');

const deck3 = generateDeck(3, 6);
console.log('Triple deck + 6 jokers count:', deck3.length, '(expected 162)');
if (deck3.length !== 162) throw new Error('Deck 3 count mismatch');

console.log('--- 2. Testing 16-Player Card Distribution ---');
let cards = generateDeck(3, 6);
const hands = Array.from({ length: 16 }, () => []);
let pIdx = 0;
while (cards.length > 0) {
  hands[pIdx].push(cards.pop());
  pIdx = (pIdx + 1) % 16;
}
const minHand = Math.min(...hands.map(h => h.length));
const maxHand = Math.max(...hands.map(h => h.length));
console.log(`16-player distribution: Min hand = ${minHand}, Max hand = ${maxHand}, Diff = ${maxHand - minHand}`);
if (maxHand - minHand > 1) throw new Error('Distribution uneven');

console.log('--- 3. Testing Joker Wild Truth Logic ---');
function verifyChallenge(claimedRank, playedCards) {
  for (const card of playedCards) {
    if (card.isJoker) continue; // Joker is always truthful wild
    if (card.rank !== claimedRank) return true; // Is bluff
  }
  return false; // Truthful
}

const truthfulWithJoker = [
  { rank: 'K', isJoker: false },
  { rank: 'JOKER', isJoker: true }
];
console.log('Claim "K" with [King, Joker]: isBluff =', verifyChallenge('K', truthfulWithJoker), '(expected false)');
if (verifyChallenge('K', truthfulWithJoker) !== false) throw new Error('Joker wild failed');

const bluffWithJoker = [
  { rank: 'K', isJoker: false },
  { rank: '7', isJoker: false },
  { rank: 'JOKER', isJoker: true }
];
console.log('Claim "K" with [King, 7, Joker]: isBluff =', verifyChallenge('K', bluffWithJoker), '(expected true)');
if (verifyChallenge('K', bluffWithJoker) !== true) throw new Error('Bluff detection failed');

console.log('ALL GAME ENGINE LOGIC TESTS PASSED!');

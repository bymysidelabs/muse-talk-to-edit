import test from 'node:test';
import assert from 'node:assert/strict';
import { koNumbers } from '../src/app/numbers.js';

const has = (text, n) => koNumbers(text).has(n);

test('reads amounts the way people say and write them', () => {
  assert.ok(has('방금 동네마트에서 이만 이천오백 원 썼어', 22500));
  assert.ok(has('고깃집 화로에서 8만 7천원', 87000));
  assert.ok(has('카카오T만 이천삼백 원 교통으로', 12300));
  assert.ok(has('올리브영 3만 5900원', 35900));
  assert.ok(has('투썸플레이스에서 6,500원', 6500));
  assert.ok(has('[KB국민체크] 11/04 13:38 16,000원 본죽 승인', 16000));
  assert.ok(has('만원', 10000));
  assert.ok(has('메가커피 이천 원', 2000));
});

test('a lone hangul digit inside a word is not a number', () => {
  assert.equal(koNumbers('이마트에서 장봤어').size, 0);
  assert.equal(koNumbers('지난달 외식비 얼마야?').size, 0);
});

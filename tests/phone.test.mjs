import test from "node:test";
import assert from "node:assert/strict";
import {
  buildE164,
  parsePhone,
  phoneCountryByCode,
  stripTrunkPrefix,
  validateNational,
} from "../shared/phone.mjs";

test("Afghan numbers with a leading 0 are the same as 9-digit national numbers", () => {
  const af = phoneCountryByCode("AF");
  assert.equal(stripTrunkPrefix(af, "0764273409"), "764273409");
  assert.equal(stripTrunkPrefix(af, "764273409"), "764273409");
  assert.equal(stripTrunkPrefix(af, "0"), "");
  const parsed = parsePhone("0764273409");
  assert.equal(parsed.country.code, "AF");
  assert.equal(parsed.national, "764273409");
  assert.equal(parsed.e164, "93764273409");
  assert.equal(buildE164("AF", "0764273409"), "93764273409");
  assert.deepEqual(validateNational("AF", "0764273409"), {
    ok: true,
    empty: false,
    e164: "93764273409",
  });
  assert.equal(validateNational("AF", "0").ok, true);
  assert.equal(parsePhone("+93764273409").e164, "93764273409");
});

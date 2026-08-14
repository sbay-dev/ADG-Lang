import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  decisionNeedsResolution,
  validateSubmissionBinding
} from "../public/protocol.js";

const repositoryRoot = new URL("../../../", import.meta.url);

test("browser packet root matches the .NET contract", async () => {
  const packet = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
    repositoryRoot
  ));
  assert.equal(
    await computePacketMerkleRoot(packet),
    "2528f0a37e372ee756a4e11de8e929f7f4a51182e9e08b35f11ff5de1be00717"
  );
});

test("browser annotation root matches the .NET contract", async () => {
  const packet = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
    repositoryRoot
  ));
  const annotation = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "annotation-a.synthetic.json",
    repositoryRoot
  ));
  await validateSubmissionBinding(packet, annotation);
  assert.equal(
    await computeAnnotationMerkleRoot(packet, annotation),
    "9cfb2aeaac30c405bda6cd28e26a0bb72cde770f4a086e17bd8620cdff0a9622"
  );
});

test("consensus override requires resolution", () => {
  assert.equal(decisionNeedsResolution("NOUN", "NOUN", "NOUN"), false);
  assert.equal(decisionNeedsResolution("NOUN", "NOUN", "PROPN"), true);
  assert.equal(decisionNeedsResolution("NOUN", "PROPN", "NOUN"), true);
});

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

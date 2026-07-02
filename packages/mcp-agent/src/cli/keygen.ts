#!/usr/bin/env node
import { loadOrCreateSessionKeypair } from '../keystore.js';

const keypair = loadOrCreateSessionKeypair();
// Only the public key is printed — paste this into the dashboard's "Agent public key"
// field when creating an agent-scoped delegation. The secret stays in the local keystore.
console.log(keypair.publicKey());

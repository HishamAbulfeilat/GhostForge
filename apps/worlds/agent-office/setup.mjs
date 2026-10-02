#!/usr/bin/env node
// Clones agent-office at the pinned commit into ./checkout/ (gitignored) and installs it.
import { setupWorld } from '../../../scripts/worlds/lib.mjs'

setupWorld('agent-office')

#!/usr/bin/env node
// Clones ai-town at the pinned commit into ./checkout/ (gitignored) and installs it.
import { setupWorld } from '../../../scripts/worlds/lib.mjs'

setupWorld('ai-town')

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import yaml from 'yaml'
import {languages} from '@arsumbris/code-syntax'
test('reader eligibility covers registered source extensions without a wildcard default',()=>{
 const type=yaml.parse(fs.readFileSync(new URL('../type/aup-reader.type.yaml',import.meta.url),'utf8'))
 const opens=type.meta.find(meta=>meta.type==='opens-meta::au-host-sdk').opens
 for(const language of languages)for(const extension of language.extensions)assert.ok(opens.includes(extension),extension)
 assert.ok(opens.includes(''))
 assert.ok(!opens.includes('*'))
 assert.ok(!opens.includes('png'))
})

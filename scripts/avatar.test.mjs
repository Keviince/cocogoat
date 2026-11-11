import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import characters from '../src/generated/amos-data/amos/characters/index.js'

const source = fs.readFileSync(new URL('../src/assets/mihoyoImages/characterIcon.ts', import.meta.url), 'utf8')
const compiled = ts
    .transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    .outputText.replace(
        '@/generated/amos-data/amos/characters/index',
        new URL('../src/generated/amos-data/amos/characters/index.js', import.meta.url).href,
    )
const { resolveCharacterKey, characterIconSources, isUnavailableAvatar } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
)

test('all upstream character keys resolve without a manually maintained whitelist', () => {
    for (const character of characters) assert.equal(resolveCharacterKey(character.key), character.key)
})
test('legacy avatar names resolve to current canonical keys', () => {
    assert.equal(resolveCharacterKey('traveler'), 'PlayerGirl')
    assert.equal(resolveCharacterKey('raiden_shogun'), 'Shougun')
    assert.equal(resolveCharacterKey('kamisato_ayaka'), 'Ayaka')
    assert.equal(resolveCharacterKey('furina'), 'Furina')
    assert.equal(resolveCharacterKey('skirk_new'), 'SkirkNew')
})
test('invalid or missing names use a valid default instead of generating broken URLs', () => {
    for (const name of [undefined, null, '', 'missing-character', '../image.png'])
        assert.equal(resolveCharacterKey(name), 'PlayerGirl')
})
test('backup image uses an independent host for the same character', () => {
    const sources = characterIconSources('furina')
    assert.notEqual(new URL(sources[0]).host, new URL(sources[1]).host)
    for (const url of sources) assert.equal(new URL(url).pathname.split('/').pop(), 'UI_AvatarIcon_Furina.png')
})
test('the HTTP 200 unavailable-image graphic is rejected without rejecting real portraits', () => {
    assert.equal(
        isUnavailableAvatar(
            'https://upload-bbs.mihoyo.com/game_record/genshin/character_icon/UI_AvatarIcon_Furina.png',
            1200,
            1200,
        ),
        true,
    )
    assert.equal(
        isUnavailableAvatar(
            'https://upload-bbs.mihoyo.com/game_record/genshin/character_icon/UI_AvatarIcon_PlayerGirl.png',
            256,
            256,
        ),
        false,
    )
    assert.equal(isUnavailableAvatar('https://enka.network/ui/UI_AvatarIcon_Furina.png', 1200, 1200), false)
    assert.equal(new URL(characterIconSources('Furina')[0]).host, 'enka.network')
})

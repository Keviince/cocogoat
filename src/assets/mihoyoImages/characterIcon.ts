import characters from '@/generated/amos-data/amos/characters/index'

const characterKeys = new Map([...characters.map(({ key }) => key), 'Paimon'].map((key) => [key.toLowerCase(), key]))
const mapping = {
    traveler: 'PlayerGirl',
    raiden_shogun: 'Shougun',
    yanfei: 'Feiyan',
    amber: 'Ambor',
    noelle: 'Noel',
    jean: 'Qin',
    thoma: 'Tohma',
    yae_miko: 'Yae',
    kamisato_ayato: 'Ayato',
} as Record<string, string>
export function resolveCharacterKey(name: string | null | undefined): string {
    const value = (name || '').trim()
    const alias = mapping[value.toLowerCase()]
    if (alias) return alias
    const candidates = [value, value.replace(/_/g, ''), value.split('_').pop() || '']
    for (const candidate of candidates) {
        const key = characterKeys.get(candidate.toLowerCase())
        if (key) return key
    }
    return 'PlayerGirl'
}

export const template = 'https://enka.network/ui/UI_AvatarIcon_#.png'
export const characterIcon = (name: string | null | undefined) => template.replace('#', resolveCharacterKey(name))
export const characterIconSources = (name: string | null | undefined) => [
    characterIcon(name),
    `https://upload-bbs.mihoyo.com/game_record/genshin/character_icon/UI_AvatarIcon_${resolveCharacterKey(name)}.png`,
]

// This CDN returns a 1200px unavailable-image graphic with HTTP 200.
export const isUnavailableAvatar = (url: string, width: number, height: number) =>
    url.startsWith('https://upload-bbs.mihoyo.com/') && width === 1200 && height === 1200

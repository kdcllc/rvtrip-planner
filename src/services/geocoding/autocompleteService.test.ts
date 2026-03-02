import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAutocompleteCache,
  fetchAutocompleteSuggestions,
  setAutocompleteProvider,
  type AutocompleteProvider,
} from './autocompleteService'

describe('autocompleteService', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
      },
      configurable: true,
      writable: true,
    })

    clearAutocompleteCache()
  })

  it('returns empty suggestions for short queries', async () => {
    const provider: AutocompleteProvider = {
      id: 'short-query-provider',
      fetchSuggestions: async () => ({
        suggestions: [
          {
            id: '1',
            mainText: 'Should not be called',
            secondaryText: '',
            location: null,
          },
        ],
      }),
    }
    setAutocompleteProvider(provider)

    const result = await fetchAutocompleteSuggestions('ab')

    expect(result.suggestions).toEqual([])
  })

  it('returns suggestions from the active provider', async () => {
    const provider: AutocompleteProvider = {
      id: 'happy-path-provider',
      fetchSuggestions: async () => ({
        suggestions: [
          {
            id: '1',
            mainText: 'Monroe',
            secondaryText: 'NC, USA',
            location: { lat: 35.0, lng: -80.0 },
          },
        ],
      }),
    }
    setAutocompleteProvider(provider)

    const result = await fetchAutocompleteSuggestions('Monroe')

    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].mainText).toBe('Monroe')
  })

  it('caches results for repeated queries', async () => {
    let calls = 0
    const provider: AutocompleteProvider = {
      id: 'cache-provider',
      fetchSuggestions: async () => {
        calls += 1
        return {
          suggestions: [
            {
              id: '1',
              mainText: 'Asheville',
              secondaryText: 'NC, USA',
              location: { lat: 35.5951, lng: -82.5515 },
            },
          ],
        }
      },
    }
    setAutocompleteProvider(provider)

    const first = await fetchAutocompleteSuggestions('Asheville')
    const second = await fetchAutocompleteSuggestions('Asheville')

    expect(first.suggestions).toHaveLength(1)
    expect(second.suggestions).toHaveLength(1)
    expect(calls).toBe(1)
  })

  it('returns empty suggestions when provider fails', async () => {
    const provider: AutocompleteProvider = {
      id: 'error-provider',
      fetchSuggestions: async () => {
        throw new Error('Provider unavailable')
      },
    }
    setAutocompleteProvider(provider)

    const result = await fetchAutocompleteSuggestions('Grand Canyon')

    expect(result.suggestions).toEqual([])
  })
})

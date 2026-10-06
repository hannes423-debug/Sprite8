import { a1111Provider } from './a1111Provider';
import { comfyUIProvider } from './comfyui/comfyuiProvider';
import { guidesProvider } from './guides';
import { sprite8HttpProvider } from './sprite8Http';
import { defaultSettings, type ImageGenerationProvider, type ProviderSettings } from './types';

/**
 * Provider registry. To add a provider (WebGPU model, another local server,
 * a remote API…) implement `ImageGenerationProvider` and add it here.
 */
export const PROVIDERS: ImageGenerationProvider[] = [
  guidesProvider,
  comfyUIProvider,
  a1111Provider,
  sprite8HttpProvider,
];

export const DEFAULT_PROVIDER_ID = guidesProvider.id;

export function getProvider(id: string | null | undefined): ImageGenerationProvider {
  return PROVIDERS.find((p) => p.id === id) ?? guidesProvider;
}

/** Stored settings merged over the provider's defaults (new fields get defaults). */
export function resolveProviderSettings(
  provider: ImageGenerationProvider,
  stored: ProviderSettings | undefined,
): ProviderSettings {
  return { ...defaultSettings(provider.settingsFields), ...(stored ?? {}) };
}

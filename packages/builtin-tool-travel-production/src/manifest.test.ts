import { describe, expect, it } from 'vitest';

import { TravelProductionManifest } from './manifest';

describe('travel production manifest', () => {
  it('exposes controlled copy, document, image and video generation contracts', () => {
    expect(TravelProductionManifest.api.map(({ name }) => name)).toEqual([
      'generateCopy',
      'generateDocument',
      'generateImage',
      'generateVideo',
    ]);

    const copyParameters = TravelProductionManifest.api[0]?.parameters as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const documentParameters = TravelProductionManifest.api[1]?.parameters as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const imageParameters = TravelProductionManifest.api[2]?.parameters as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const videoParameters = TravelProductionManifest.api[3]?.parameters as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(Object.keys(copyParameters.properties ?? {})).toEqual(['prompt']);
    expect(copyParameters.required).toEqual(['prompt']);
    expect(copyParameters.additionalProperties).toBe(false);
    expect(Object.keys(documentParameters.properties ?? {})).toEqual(['prompt', 'title']);
    expect(documentParameters.required).toEqual(['prompt']);
    expect(documentParameters.additionalProperties).toBe(false);
    expect(Object.keys(imageParameters.properties ?? {})).toEqual(['imageNum', 'prompt']);
    expect(imageParameters.properties?.imageNum).toMatchObject({ maximum: 1, minimum: 1 });
    expect(imageParameters.required).toEqual(['prompt']);
    expect(imageParameters.additionalProperties).toBe(false);
    expect(Object.keys(videoParameters.properties ?? {})).toEqual(['prompt']);
    expect(videoParameters.required).toEqual(['prompt']);
    expect(videoParameters.additionalProperties).toBe(false);
  });
});

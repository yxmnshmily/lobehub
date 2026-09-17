// @lobehub/ui 5.42.2 ships these runtime modules without their declarations.
// Its bundled source maps declare both exports as Ant Design MappingAlgorithm.
declare module '@lobehub/ui/es/styles/theme/algorithms/darkAlgorithm' {
  import type { MappingAlgorithm } from 'antd/es/theme/interface';

  export const darkAlgorithm: MappingAlgorithm;
}

declare module '@lobehub/ui/es/styles/theme/algorithms/lightAlgorithm' {
  import type { MappingAlgorithm } from 'antd/es/theme/interface';

  export const lightAlgorithm: MappingAlgorithm;
}

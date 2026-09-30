/** 開場用的剪影資料型別。實際圖形由上傳的插畫描出，不放進公開的 repo（公開版為 null，開場就不畫剪影）。 */
export interface KikyoSilhouette { viewBox: [number, number, number, number]; tailPivot: [number, number]; halo: string; torso: string; tail: string }
export interface ShigurePrint { viewBox: [number, number, number, number]; tone: string; solid: string; lines: string }

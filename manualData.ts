// src/manualData.ts

export interface MovieManualData {
  posterUrl?: string;      // 수동 설정할 포스터 이미지 주소 (비워두면 자동 검색)
  productionCost?: number; // 총 제작비 (단위: 원, 비워두면 BEP 분석 생략)
}

// [사용자 입력 공간]
// 영화 제목을 정확히 입력해야 매칭됩니다. (띄어쓰기 주의)
export const MANUAL_MOVIE_DATA: Record<string, MovieManualData> = {
  "휴민트": {
    posterUrl: "https://www.kobis.or.kr/common/mast/movie/2025/12/da9db1d1320f4edd948e3b5c78e4e11d.jpg", // 예시 링크
    productionCost: 23500000000 // 235억
  },
  "만약에 우리": {
    posterUrl: "https://www.kobis.or.kr/common/mast/movie/2026/01/b6babf8b10924a168025ba53d8607d00.jpg",
    productionCost: 4000000000 // 40억
  },
  "프로젝트 Y": {
    posterUrl: "https://www.kobis.or.kr/common/mast/movie/2026/01/eb48fc599cc24e5aa0b731ca54d52329.jpg",
    productionCost: 0 //
  },
  // 필요한 영화를 계속 추가하세요...
};

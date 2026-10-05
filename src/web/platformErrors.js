const messages = {
  INVALID_SLUG: '전략 주소 이름은 영문 소문자로 시작하는 3~48자의 영문·숫자·하이픈으로 입력하세요.',
  STRATEGY_SLUG_TAKEN: '이미 사용 중인 전략 주소 이름입니다. 다른 이름을 입력하세요.',
  INVALID_DISPLAY_NAME: '공개 이름은 2~60자로 입력하세요.',
  INVALID_BIO: '소개는 2~500자로 입력하세요.',
  INVALID_STRATEGY_NAME: '전략명은 2~100자로 입력하세요.',
  INVALID_DESCRIPTION: '전략 설명은 2~500자로 입력하세요.',
  LEVERAGE_LIMIT: '목표 비중의 절댓값 합이 이 전략의 최대 레버리지를 초과했습니다.',
  INVALID_SETTLEMENT_SCHEDULE: '정산 오프셋과 신청 마감 시간은 정산 주기보다 짧아야 합니다.',
  CANNOT_CANCEL: '신청 마감이 지났거나 이미 정산 중인 출금은 취소할 수 없습니다.',
  DEPOSIT_RECEIPT_INVALID: '입금 거래가 아직 확인되지 않았습니다. 지갑에서 확정을 확인한 후 TEE 반영을 다시 시도하세요.',
  INTERNAL_ERROR: '서버 연결이 일시적으로 지연됩니다. 잠시 후 다시 시도해 주세요.',
  STRATEGY_AUTHORIZATION_FAILED: 'API 토큰과 선택한 전략을 확인해 주세요. 연결이 지연된 경우 다시 시도할 수 있습니다.',
  INSUFFICIENT_STRATEGY_CASH_MIN_ACCOUNT_100_AUSD: '전략의 현금이 부족합니다. Perpl 최초 계정에는 시장마다 최소 100 AUSD가 필요합니다. 자기자본을 추가하거나 시장 수를 줄여 다시 제출하세요.',
  PREVIOUS_REQUEST_PENDING: '이전 주문이 처리 중입니다. 실행 상태를 확인한 후 제출해 주세요.',
  SETTLEMENT_IN_PROGRESS: '출금 정산이 진행 중입니다. 지급 완료 후 제출할 수 있습니다.',
  STRATEGY_HALTED: '위험 한도에 도달해 운용이 중단됐습니다. 포지션 정리가 끝나면 운용 재개를 선택하세요.',
  POLICY_CHANGE_ALREADY_PENDING: '이미 공지한 설정 변경이 있습니다. 적용된 후 다시 변경할 수 있습니다.',
  INVALID_FEE_BPS: '성과보수는 0~20%로 입력하세요.',
  ORDER_EXPIRED: '주문 유효 시간이 지났습니다. 실제 처리 상태를 확인한 뒤 다시 제출하세요.',
  WITHDRAWAL_LIQUIDITY_PENDING: '출금에 필요한 현금을 확보 중입니다. 정산 상태를 다시 확인해 주세요.'
};
export const platformError = error => { const code = typeof error === 'string' ? error : error?.shortMessage || error?.message || String(error); return messages[code] || code; };

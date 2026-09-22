/** 브라우저에서 파일로 내려받기. CSV·로그 내보내기에 쓴다. */
export const download = (name: string, text: string, type = 'text/plain') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

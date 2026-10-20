const scripts: Array<[RegExp, RegExp, string]> = [
 [/^(hindi|हिंदी|हिन्दी|hi(?:[-_].*)?)$/i,/\p{Script=Devanagari}/u,'Hindi'],
 [/^(marathi|मराठी|mr(?:[-_].*)?)$/i,/\p{Script=Devanagari}/u,'Marathi'],
 [/^(tamil|தமிழ்|ta(?:[-_].*)?)$/i,/\p{Script=Tamil}/u,'Tamil'],
 [/^(malayalam|മലയാളം|ml(?:[-_].*)?)$/i,/\p{Script=Malayalam}/u,'Malayalam'],
 [/^(bengali|বাংলা|bn(?:[-_].*)?)$/i,/\p{Script=Bengali}/u,'Bengali'],
 [/^(kannada|ಕನ್ನಡ|kn(?:[-_].*)?)$/i,/\p{Script=Kannada}/u,'Kannada'],
 [/^(gujarati|ગુજરાતી|gu(?:[-_].*)?)$/i,/\p{Script=Gujarati}/u,'Gujarati'],
];
export function nativeTitleIssue(language: string, title: string): string | null {
  const rule=scripts.find(([match])=>match.test(language.trim()));
  return rule && /\p{L}/u.test(title) && !rule[1].test(title) ? `Enter the book title in ${rule[2]}. Use the Roman spelling field for its transliteration.` : null;
}

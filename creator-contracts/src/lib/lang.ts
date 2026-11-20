import { cookies } from "next/headers";
import { translate, type Lang, type T } from "./i18n";

export const LANG_COOKIE = "dalba_lang";

/** Manager screens default to Korean; the choice is remembered per browser. */
export async function getLang(): Promise<Lang> {
  return (await cookies()).get(LANG_COOKIE)?.value === "en" ? "en" : "ko";
}

export async function getT(): Promise<{ t: T; lang: Lang }> {
  const lang = await getLang();
  return { lang, t: (en, vars) => translate(lang, en, vars) };
}

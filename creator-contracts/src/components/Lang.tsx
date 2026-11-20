"use client";

import { createContext, useContext } from "react";
import { translate, type Lang, type T } from "@/lib/i18n";

const Ctx = createContext<Lang>("ko");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

export function useLang(): Lang {
  return useContext(Ctx);
}

export function useT(): T {
  const lang = useContext(Ctx);
  return (en, vars) => translate(lang, en, vars);
}

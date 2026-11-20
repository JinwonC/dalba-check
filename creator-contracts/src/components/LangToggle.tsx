import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANG_COOKIE } from "@/lib/lang";
import type { Lang } from "@/lib/i18n";

async function setLang(lang: Lang) {
  "use server";
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export default function LangToggle({ lang }: { lang: Lang }) {
  return (
    <form className="lang" role="group" aria-label="Language">
      <button formAction={setLang.bind(null, "ko")} aria-pressed={lang === "ko"}>
        한국어
      </button>
      <button formAction={setLang.bind(null, "en")} aria-pressed={lang === "en"}>
        English
      </button>
    </form>
  );
}

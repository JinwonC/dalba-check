import { bridgeConfigured, callBridge } from "./bridge";

export const sheetConfigured = bridgeConfigured;

/** Adds a row to the work-request sheet: 요청일 / 요청자 / 요청내용 / 요청 업무 내용 / 요청 폴더 링크. */
export async function appendRequestRow(row: { date: string; requester: string; kind: string; text: string; folder: string }): Promise<void> {
  await callBridge({ action: "row", ...row });
}

import { describe, expect, it, vi } from "vitest";

import { dedupeByNumber, filterInviteContacts, inviteContactsFrom, inviteOne, phoneKey, type InviteContact } from "../mobile/lib/contactsInvite";

const c = (id: string, name: string, phone: string): InviteContact => ({ id, name, phone });

describe("inviteOne: one recipient per message, never a group", () => {
  it("gives the composer exactly one number", async () => {
    const sendSms = vi.fn(async () => ({ result: "sent" }));
    const share = vi.fn(async () => undefined);
    const how = await inviteOne(c("1", "Sam", "203-555-0100"), "Join me", { isSmsAvailable: async () => true, sendSms, share });
    expect(how).toBe("composer");
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith(["203-555-0100"], "Join me");
    expect(share).not.toHaveBeenCalled();
  });

  it("falls back to the share sheet for that one person, with no number attached", async () => {
    const sendSms = vi.fn();
    const share = vi.fn(async () => undefined);
    const how = await inviteOne(c("1", "Sam", "203-555-0100"), "Join me", { isSmsAvailable: async () => false, sendSms, share });
    expect(how).toBe("share");
    expect(sendSms).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith("Join me");
  });

  it("a queue of several contacts makes one single-recipient composer call each", async () => {
    const calls: string[][] = [];
    const sender = { isSmsAvailable: async () => true, sendSms: async (a: string[]) => void calls.push(a), share: async () => undefined };
    for (const person of [c("1", "A", "111"), c("2", "B", "222"), c("3", "C", "333")]) await inviteOne(person, "m", sender);
    expect(calls).toEqual([["111"], ["222"], ["333"]]);
    expect(calls.every((a) => a.length === 1)).toBe(true);
  });
});

describe("queue helpers", () => {
  it("treats +1 and formatting as the same number", () => {
    expect(phoneKey("+1 (203) 555-0100")).toBe(phoneKey("203.555.0100"));
  });
  it("texts nobody twice", () => {
    const list = [c("1", "Sam", "203-555-0100"), c("2", "Sam R", "+1 203 555 0100"), c("3", "Alex", "917-555-0111")];
    expect(dedupeByNumber(list).map((x) => x.id)).toEqual(["1", "3"]);
  });
  it("keeps only contacts with a name and a number, A to Z, and filters on-device", () => {
    const list = inviteContactsFrom([
      { id: "b", name: "Zed", phoneNumbers: [{ number: "555-0002" }] },
      { id: "a", name: "Amy", phoneNumbers: [{ number: "555-0001", isPrimary: true }] },
      { id: "n", name: "No Number", phoneNumbers: [] },
    ]);
    expect(list.map((x) => x.name)).toEqual(["Amy", "Zed"]);
    expect(filterInviteContacts(list, "zed").map((x) => x.id)).toEqual(["b"]);
  });
});

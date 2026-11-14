"use strict";
/* Single mutable app state. Screens read it, actions change it, render() paints it. */
const TAB_SCREENS = ["home", "explore", "notif", "profile"];
const CATEGORY_LABELS = ["شاعری", "افسانہ", "کالم", "مضمون", "سفرنامہ"];
const TOPIC_LABELS = ["ادب", "محبت", "سماج", "زندگی", "سفر", "ٹیکنالوجی"];
const COUNTRIES = [["", "بتانا نہیں چاہتے"], ["PK", "پاکستان"], ["IN", "بھارت"], ["AE", "متحدہ عرب امارات"], ["SA", "سعودی عرب"], ["GB", "برطانیہ"], ["US", "امریکہ"], ["CA", "کینیڈا"]];
const NEW_WRITE = () => ({
  id: null, t: "", b: "", cat: "مضمون", topic: "ادب", support: true,
  coverPath: null, coverUrl: "", coverFile: null, coverObjectUrl: "",
  bad: false, editing: false, status: "", saving: Promise.resolve(), touched: false,
});

const S = {
  /* session */
  user: null, me: null, suspended: false, cfgError: "", booted: false,
  /* navigation */
  scr: "splash", params: {}, stack: [], keep: false, scrollY: 0,
  /* preferences (persisted) */
  theme: "auto", fs: 1, nk: false, rc: false,
  /* caches */
  posts: new Map(),          // id -> post view model
  liked: new Set(), saved: new Set(), following: new Set(), blocked: new Set(),
  interests: new Set(),
  lists: {},                 // key -> {items, from, done, loading, err, t}
  v: {},                     // key -> {st:'loading'|'ok'|'err', d, e, t}
  unread: 0,
  /* UI */
  sheet: null,
  busy: new Set(),
  online: true,
  fields: {},                // generic bound inputs: data-f="key"
  w: NEW_WRITE(),            // composer
  ed: null,                  // profile edit buffer
  feedTab: 0, cat: "", topic: "", q: "",
  crop: null,
};

const FEED_PAGE = 15;
const requireOnline = () => navigator.onLine !== false;

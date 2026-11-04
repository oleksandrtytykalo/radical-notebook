// Sentence grammar for the sentence games. Instead of a fixed list, every round builds a fresh
// sentence: a PATTERN (e.g. "S 喜欢 X") is filled with words from LEXICON categories, and the
// English is generated alongside it with proper agreement ("I like" / "she likes").
// Every Chinese token is a word from WORDS (or SENT_EXTRA), so tiles are always real vocabulary.
// Tokens inside one entry are separated by spaces: "我 的 朋友" is three tiles.

const SENT_TOPICS = [
  ["basics", "People"], ["food", "Food & drink"], ["shop", "Shopping"],
  ["dir", "Directions"], ["place", "Places"], ["free", "Transport & free time"],
];
// Small words used in sentences that aren't vocabulary entries of their own
const SENT_EXTRA = { "一": { pinyin: "yī", en: "one" }, "二": { pinyin: "èr", en: "two" } };
// Time words may also go before the subject: 我明天去 = 明天我去
const SENT_TIME = new Set(["明天", "周末", "星期六"]);

const LEXICON = {
  // s: takes "likes/is" (he/she/it); pl: plural subject
  SUBJ: [
    { zh: "我", en: "I", be: "am" },
    { zh: "你", en: "you", be: "are" },
    { zh: "她", en: "she", be: "is", s: 1 },
    { zh: "我们", en: "we", be: "are", pl: 1 },
    { zh: "你们", en: "you", be: "are", pl: 1 },
    { zh: "妈妈", en: "Mum", be: "is", s: 1 },
    { zh: "爸爸", en: "Dad", be: "is", s: 1 },
    { zh: "我 的 朋友", en: "my friend", be: "is", s: 1 },
    { zh: "我 的 同学", en: "my classmate", be: "is", s: 1 },
    { zh: "我 的 同事", en: "my colleague", be: "is", s: 1 },
    { zh: "姑妈", en: "my aunt", be: "is", s: 1 },
    { zh: "爷爷", en: "Grandpa", be: "is", s: 1 },
    { zh: "奶奶", en: "Grandma", be: "is", s: 1 },
  ],
  ROLE: [
    { zh: "学生", sg: "a student", pl: "students" },
    { zh: "留学生", sg: "an international student", pl: "international students" },
    { zh: "中国 人", sg: "Chinese", pl: "Chinese" },
    { zh: "英国 人", sg: "British", pl: "British" },
  ],
  // en: as said after a verb ("I like apples"); pl: takes "are"; mw: measure words that fit;
  // two: how "两个 X" reads in English when 个 is allowed
  FOOD: [
    { zh: "苹果", en: "apples", pl: 1, mw: ["斤", "个"], two: "two apples" },
    { zh: "草莓", en: "strawberries", pl: 1, mw: ["斤", "盒"] },
    { zh: "香蕉", en: "bananas", pl: 1, mw: ["斤"] },
    { zh: "葡萄", en: "grapes", pl: 1, mw: ["公斤", "斤"] },
    { zh: "西红柿", en: "tomatoes", pl: 1, mw: ["斤"] },
    { zh: "蓝莓", en: "blueberries", pl: 1, mw: ["盒"] },
    { zh: "面包", en: "bread", mw: ["个"], two: "two pieces of bread" },
    { zh: "鸡蛋", en: "eggs", pl: 1, mw: ["个"], two: "two eggs" },
    { zh: "鱼", en: "fish", mw: [] },
    { zh: "牛肉", en: "beef", mw: ["公斤", "斤"] },
    { zh: "米饭", en: "rice", mw: ["碗"] },
    { zh: "面条", en: "noodles", pl: 1, mw: ["碗"] },
    { zh: "巧克力", en: "chocolate", mw: ["盒"] },
    { zh: "奶酪", en: "cheese", mw: [] },
    { zh: "薯条", en: "chips", pl: 1, mw: [] },
  ],
  DRINK: [
    { zh: "茶", en: "tea", mw: ["杯"] },
    { zh: "咖啡", en: "coffee", mw: ["杯"] },
    { zh: "牛奶", en: "milk", mw: ["杯"] },
    { zh: "奶茶", en: "milk tea", mw: ["杯"] },
    { zh: "水", en: "water", mw: ["杯"] },
  ],
  CLOTH: [
    { zh: "衬衫", mw: "件", this: "this shirt" },
    { zh: "裙子", mw: "条", this: "this skirt" },
    { zh: "鞋", mw: "双", this: "this pair of shoes" },
  ],
  PLACE: [
    { zh: "银行", en: "the bank" }, { zh: "火车站", en: "the train station" }, { zh: "邮局", en: "the post office" },
    { zh: "电影院", en: "the cinema" }, { zh: "医院", en: "the hospital" }, { zh: "超市", en: "the supermarket" },
    { zh: "商店", en: "the shop" }, { zh: "饭馆儿", en: "the restaurant" }, { zh: "学校", en: "the school" },
    { zh: "地铁站", en: "the subway station" }, { zh: "公园", en: "the park" }, { zh: "公司", en: "the company", work: 1 },
    { zh: "大学", en: "the university", work: 1 },
  ],
  CITY: [{ zh: "北京", en: "Beijing" }, { zh: "上海", en: "Shanghai" }, { zh: "西安", en: "Xi'an" }],
  POS: [
    { zh: "旁边", en: "next to" }, { zh: "对面", en: "opposite" }, { zh: "前边", en: "in front of" }, { zh: "后边", en: "behind" },
    { zh: "东边", en: "east of" }, { zh: "西边", en: "west of" }, { zh: "南边", en: "south of" }, { zh: "北边", en: "north of" },
  ],
  // things you do: base form, -ing form
  ACT: [
    { zh: "打篮球", en: "play basketball", ing: "playing basketball" },
    { zh: "打网球", en: "play tennis", ing: "playing tennis" },
    { zh: "打游戏", en: "play video games", ing: "playing video games" },
    { zh: "看 电影", en: "watch films", ing: "watching films" },
    { zh: "跑步", en: "go jogging", ing: "jogging" },
    { zh: "学习 汉语", en: "study Chinese", ing: "studying Chinese" },
  ],
  JOB: [
    { zh: "工作", en: "work" }, { zh: "打工", en: "work part-time" }, { zh: "学习 汉语", en: "study Chinese" },
  ],
  TRANS: [
    { zh: "坐 公共汽车", en: "take the bus" }, { zh: "坐 火车", en: "take the train" }, { zh: "坐 地铁", en: "take the subway" },
    { zh: "开车", en: "drive" }, { zh: "骑 自行车", en: "ride a bike" }, { zh: "走路", en: "walk" }, { zh: "打车", en: "take a taxi" },
  ],
  TIME: [
    { zh: "明天", en: "tomorrow", future: 1 }, { zh: "周末", en: "at the weekend" }, { zh: "星期六", en: "on Saturday" },
  ],
  DIR: [{ zh: "前", en: "ahead" }, { zh: "北", en: "north" }, { zh: "南", en: "south" }, { zh: "东", en: "east" }, { zh: "西", en: "west" }],
  ORD: [{ zh: "一", en: "first" }, { zh: "二", en: "second" }],
  SIDE: [{ zh: "左", en: "left" }, { zh: "右", en: "right" }],
  ADJ: [{ zh: "高兴", en: "happy" }, { zh: "好", en: "well" }],
};
LEXICON.EAT = [...LEXICON.FOOD, ...LEXICON.DRINK];
const MW_UNIT = { "杯": ["cup", "cups"], "斤": ["jin", "jin"], "公斤": ["kilo", "kilos"], "碗": ["bowl", "bowls"], "盒": ["box", "boxes"] };

/* English helpers */
function verb3(v) { // "watch films" → "watches films"
  const [w, ...rest] = v.split(" ");
  const f = w === "have" ? "has" : /(s|sh|ch|x|o)$/.test(w) ? w + "es" : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : w + "s";
  return [f, ...rest].join(" ");
}
const agree = (S, v) => (S.s ? verb3(v) : v);
const doo = (S) => (S.s ? "does" : "do");
const dont = (S) => (S.s ? "doesn't" : "don't");
const isAre = (x) => (x.pl ? "are" : "is");
const role = (S, R) => (S.pl ? R.pl : R.sg);
const twoOf = (X, M) => (M === "个" ? X.two : `two ${MW_UNIT[M][1]} of ${X.en}`);
const subjects = (keep) => LEXICON.SUBJ.filter((S) => keep(S));
const notI = (S) => S.zh !== "我";

// Patterns. slots: name → category (or a function of the slots picked so far, for things like
// measure words that depend on the noun). zh: tokens, slot names in place. en: the English.
const PATTERNS = [
  { id: "is-role", topic: "basics", slots: { S: () => subjects((S) => !/爷爷|奶奶|妈妈|爸爸|姑妈/.test(S.zh)), R: "ROLE" }, zh: "S 是 R 。", en: (v) => `${v.S.en} ${v.S.be} ${role(v.S, v.R)}.` },
  { id: "not-role", topic: "basics", slots: { S: () => subjects((S) => !/爷爷|奶奶|妈妈|爸爸|姑妈/.test(S.zh)), R: "ROLE" }, zh: "S 不 是 R 。", en: (v) => `${v.S.en} ${v.S.be} not ${role(v.S, v.R)}.` },
  { id: "role-q", topic: "basics", slots: { S: () => subjects((S) => notI(S) && !/爷爷|奶奶|妈妈|爸爸|姑妈/.test(S.zh)), R: "ROLE" }, zh: "S 是 R 吗 ？", en: (v) => `${v.S.be} ${v.S.en} ${role(v.S, v.R)}?` },
  { id: "very-adj", topic: "basics", slots: { S: "SUBJ", A: "ADJ" }, zh: "S 很 A 。", en: (v) => `${v.S.en} ${v.S.be} very ${v.A.en}.` },
  { id: "also-adj", topic: "basics", slots: { S: "SUBJ" }, zh: "S 也 很 高兴 。", en: (v) => `${v.S.en} ${v.S.be} very happy too.` },

  { id: "like", topic: "food", slots: { S: "SUBJ", X: "EAT" }, zh: "S 喜欢 X 。", en: (v) => `${v.S.en} ${agree(v.S, "like")} ${v.X.en}.` },
  { id: "really-like", topic: "food", slots: { S: "SUBJ", X: "EAT" }, zh: "S 很 喜欢 X 。", en: (v) => `${v.S.en} really ${agree(v.S, "like")} ${v.X.en}.` },
  { id: "not-like", topic: "food", slots: { S: "SUBJ", X: "EAT" }, zh: "S 不 喜欢 X 。", en: (v) => `${v.S.en} ${dont(v.S)} like ${v.X.en}.` },
  { id: "like-q", topic: "food", slots: { S: () => subjects(notI), X: "EAT" }, zh: "S 喜欢 X 吗 ？", en: (v) => `${doo(v.S)} ${v.S.en} like ${v.X.en}?` },
  { id: "also-like", topic: "food", slots: { S: "SUBJ", X: "EAT" }, zh: "S 也 喜欢 X 。", en: (v) => `${v.S.en} ${agree(v.S, "like")} ${v.X.en} too.` },
  { id: "eat", topic: "food", slots: { S: "SUBJ", X: "FOOD" }, zh: "S 吃 X 。", en: (v) => `${v.S.en} ${agree(v.S, "eat")} ${v.X.en}.` },
  { id: "not-eat", topic: "food", slots: { S: "SUBJ", X: "FOOD" }, zh: "S 不 吃 X 。", en: (v) => `${v.S.en} ${dont(v.S)} eat ${v.X.en}.` },
  { id: "drink-q", topic: "food", slots: { S: () => subjects(notI), X: "DRINK" }, zh: "S 喝 X 吗 ？", en: (v) => `${doo(v.S)} ${v.S.en} drink ${v.X.en}?` },
  { id: "drink-or", topic: "food", slots: { S: () => subjects(notI), X: "DRINK", Y: (v) => LEXICON.DRINK.filter((d) => d !== v.X) }, zh: "S 喝 X 还是 Y ？", en: (v) => `${doo(v.S)} ${v.S.en} drink ${v.X.en} or ${v.Y.en}?` },
  { id: "want-two", topic: "food", slots: { S: "SUBJ", X: () => LEXICON.EAT.filter((x) => x.mw.length), M: (v) => v.X.mw }, zh: "S 要 两 M X 。", en: (v) => `${v.S.en} ${agree(v.S, "want")} ${twoOf(v.X, v.M)}.` },
  { id: "want-what", topic: "food", slots: { S: () => subjects(notI), V: () => [{ zh: "吃", en: "eat" }, { zh: "喝", en: "drink" }] }, zh: "S 要 V 什么 ？", en: (v) => `What ${doo(v.S)} ${v.S.en} want to ${v.V.en}?` },
  { id: "tasty", topic: "food", slots: { X: "FOOD" }, zh: "X 很 好吃 。", en: (v) => `The ${v.X.en} ${isAre(v.X)} very tasty.` },

  { id: "price", topic: "shop", slots: { X: "EAT" }, zh: "X 多少 钱 ？", en: (v) => `How much ${isAre(v.X)} the ${v.X.en}?` },
  { id: "sell", topic: "shop", slots: { X: "FOOD" }, zh: "X 怎么 卖 ？", en: (v) => `How much ${isAre(v.X)} the ${v.X.en}?` },
  { id: "unit-price", topic: "shop", slots: { X: () => LEXICON.FOOD.filter((x) => x.mw.some((m) => MW_UNIT[m])), M: (v) => v.X.mw.filter((m) => MW_UNIT[m]) }, zh: "X 多少 钱 一 M ？", en: (v) => `How much is a ${MW_UNIT[v.M][0]} of ${v.X.en}?` },
  { id: "buy-two", topic: "shop", slots: { S: "SUBJ", X: () => LEXICON.EAT.filter((x) => x.mw.length), M: (v) => v.X.mw }, zh: "S 买 两 M X 。", en: (v) => `${v.S.en} ${agree(v.S, "buy")} ${twoOf(v.X, v.M)}.` },
  { id: "lets-buy", topic: "shop", slots: { X: "EAT" }, zh: "我们 买 X 吧 。", en: (v) => `Let's buy ${v.X.en}.` },
  { id: "cloth-price", topic: "shop", slots: { C: "CLOTH" }, zh: "这 C 多少 钱 ？", en: (v) => `How much is ${v.C.this}?`, expand: { C: (c) => `${c.mw} ${c.zh}` } },
  { id: "like-cloth", topic: "shop", slots: { S: "SUBJ", C: "CLOTH" }, zh: "S 喜欢 这 C 。", en: (v) => `${v.S.en} ${agree(v.S, "like")} ${v.C.this}.`, expand: { C: (c) => `${c.mw} ${c.zh}` } },

  { id: "how-get", topic: "dir", slots: { P: "PLACE" }, zh: "请问 P 怎么 走 ？", en: (v) => `Excuse me, how do I get to ${v.P.en}?` },
  { id: "straight", topic: "dir", slots: { D: "DIR" }, zh: "一直 往 D 走 。", en: (v) => `Go straight ${v.D.en}.` },
  { id: "turn", topic: "dir", slots: { O: "ORD", T: "SIDE" }, zh: "第 O 个 路口 T 拐 。", en: (v) => `Turn ${v.T.en} at the ${v.O.en} intersection.` },
  { id: "is-there", topic: "dir", slots: { P: "PLACE" }, zh: "那个 大楼 就 是 P 。", en: (v) => `That building is ${v.P.en}.` },

  { id: "where", topic: "place", slots: { P: "PLACE" }, zh: "P 在 哪儿 ？", en: (v) => `Where is ${v.P.en}?` },
  { id: "rel", topic: "place", slots: { P: "PLACE", Q: (v) => LEXICON.PLACE.filter((p) => p !== v.P), R: "POS" }, zh: "P 在 Q R 。", en: (v) => `${v.P.en} is ${v.R.en} ${v.Q.en}.` },
  { id: "go", topic: "place", slots: { S: "SUBJ", P: () => [...LEXICON.PLACE, ...LEXICON.CITY] }, zh: "S 去 P 。", en: (v) => `${v.S.en} ${agree(v.S, "go")} to ${v.P.en}.` },
  { id: "go-time", topic: "place", slots: { S: "SUBJ", T: "TIME", P: () => [...LEXICON.PLACE, ...LEXICON.CITY] }, zh: "S T 去 P 。", en: (v) => (v.T.future ? `${v.S.en} ${v.S.be} going to ${v.P.en} ${v.T.en}.` : `${v.S.en} ${agree(v.S, "go")} to ${v.P.en} ${v.T.en}.`) },
  { id: "where-go", topic: "place", slots: { S: () => subjects(notI) }, zh: "S 去 哪儿 ？", en: (v) => `Where ${v.S.be} ${v.S.en} going?` },
  { id: "work-at", topic: "place", slots: { S: "SUBJ", P: () => LEXICON.PLACE.filter((p) => !/火车站|地铁站|公园|电影院/.test(p.zh)), J: (v) => LEXICON.JOB.filter((j) => !/学习/.test(j.zh) || /学校|大学/.test(v.P.zh)) }, zh: "S 在 P J 。", en: (v) => `${v.S.en} ${agree(v.S, v.J.en)} at ${v.P.en}.` },

  { id: "travel", topic: "free", slots: { S: "SUBJ", M: "TRANS", P: (v) => (/走路|骑/.test(v.M.zh) ? LEXICON.PLACE : [...LEXICON.PLACE, ...LEXICON.CITY]) }, zh: "S M 去 P 。", en: (v) => `${v.S.en} ${agree(v.S, v.M.en)} to ${v.P.en}.` },
  { id: "like-act", topic: "free", slots: { S: "SUBJ", A: "ACT" }, zh: "S 喜欢 A 。", en: (v) => `${v.S.en} ${agree(v.S, "like")} ${v.A.ing}.` },
  { id: "like-act-q", topic: "free", slots: { S: () => subjects(notI), A: "ACT" }, zh: "S 喜欢 A 吗 ？", en: (v) => `${doo(v.S)} ${v.S.en} like ${v.A.ing}?` },
  { id: "act-time", topic: "free", slots: { S: "SUBJ", T: "TIME", A: "ACT" }, zh: "S T A 。", en: (v) => (v.T.future ? `${v.S.en} ${v.S.be} going to ${v.A.en} ${v.T.en}.` : `${v.S.en} ${agree(v.S, v.A.en)} ${v.T.en}.`) },
  { id: "lets-act", topic: "free", slots: { A: "ACT" }, zh: "我们 A 吧 。", en: (v) => `Let's ${v.A.en}.` },
  { id: "all-like", topic: "free", slots: { A: "ACT" }, zh: "我们 都 喜欢 A 。", en: (v) => `We all like ${v.A.ing}.` },
  { id: "plan-how", topic: "free", slots: { S: () => subjects(notI), P: () => [...LEXICON.PLACE, ...LEXICON.CITY] }, zh: "S 打算 怎么 去 P ？", en: (v) => `How ${doo(v.S)} ${v.S.en} plan to get to ${v.P.en}?` },
];

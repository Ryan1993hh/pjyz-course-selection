/**
 * 教师语录：本地预置 + 联网拉取 /data/teacher-quotes.json 更新
 */
(function (global) {
  var CACHE_KEY = 'pjyz_teacher_quotes_v1';
  var CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小时尝试联网更新

  var FALLBACK = [
    "教育不是填满一桶水，而是点燃一把火。",
    "好老师胜过好学校。",
    "学而不厌，诲人不倦。",
    "师者，传道授业解惑也。",
    "教学相长，与学生共同成长。",
    "每个孩子都是一颗种子，静待花开。",
    "用爱心浇灌，用耐心陪伴。",
    "今天的汗水，是明天的收获。",
    "课堂一分钟，台下十年功。",
    "因材施教，让每个孩子发光。",
    "严慈相济，方得始终。",
    "读万卷书，行万里路。",
    "知之者不如好之者，好之者不如乐之者。",
    "学然后知不足，教然后知困。",
    "三人行，必有我师焉。",
    "温故而知新，可以为师矣。",
    "不愤不启，不悱不发。",
    "己所不欲，勿施于人。",
    "博学之，审问之，慎思之，明辨之，笃行之。",
    "玉不琢，不成器；人不学，不知道。",
    "师严然后道尊。",
    "春蚕到死丝方尽，蜡炬成灰泪始干。",
    "随风潜入夜，润物细无声。",
    "爱是教育的灵魂。",
    "用心倾听每一个孩子的声音。",
    "教育的目标是培养完整的人。",
    "课堂是师生共同创造的舞台。",
    "好的提问比好的答案更重要。",
    "错误是学习路上最好的老师。",
    "鼓励比批评更有力量。",
    "细节决定课堂的品质。",
    "准备充分，从容不迫。",
    "微笑是最好的开场白。",
    "尊重学生，赢得尊重。",
    "公平对待每一个孩子。",
    "表扬要具体，批评要温和。",
    "让课堂有趣，让学习有味。",
    "动手实践，学以致用。",
    "合作探究，共同进步。",
    "批判性思维从提问开始。",
    "阅读使人充实，思考使人深邃。",
    "好习惯受益终身。",
    "自律是自由的前提。",
    "今日事今日毕。",
    "千里之行，始于足下。",
    "锲而不舍，金石可镂。",
    "失败是成功之母。",
    "态度决定高度。",
    "专注当下，全力以赴。",
    "慢即是快，少即是多。",
    "教学是一门艺术，也是一门科学。",
    "反思让教学不断精进。",
    "同行交流，取长补短。",
    "终身学习，与时俱进。",
    "新技术是工具，育人才是目的。",
    "板书是课堂的另一种语言。",
    "眼神交流传递关注与信任。",
    "留白给学生思考的时间。",
    "节奏感让课堂张弛有度。",
    "过渡语是课堂的润滑剂。",
    "作业设计体现教学智慧。",
    "评价是为了更好地成长。",
    "家校携手，共育未来。",
    "信任是教育的基础。",
    "榜样无声，胜于千言。",
    "身教重于言教。",
    "宽容但不纵容。",
    "规则之内有自由。",
    "纪律是学习的保障。",
    "安静的环境孕育深度思考。",
    "热闹的活动激发创造活力。",
    "动静结合，效率更高。",
    "早读的声音是校园最美的旋律。",
    "课间十分钟，放松也重要。",
    "体育锻炼强健体魄与意志。",
    "美育陶冶情操，开阔视野。",
    "劳动教育培养责任意识。",
    "科学精神从质疑与验证中来。",
    "人文素养让知识有温度。",
    "跨学科融合激发新思路。",
    "项目式学习贴近真实世界。",
    "差异化教学照顾每个层次。",
    "分层作业让进步看得见。",
    "个别辅导补齐短板。",
    "小组合作培养团队精神。",
    "展示交流锻炼表达能力。",
    "写作是思考的结晶。",
    "数学之美在于逻辑与简洁。",
    "语言是思维的外壳。",
    "历史照见未来。",
    "地理连接世界与中国。",
    "实验是化学的灵魂。",
    "生物课堂充满生命的奇迹。",
    "音乐让心灵共鸣。",
    "美术让想象飞翔。",
    "信息技术赋能创新。",
    "体育精神：拼搏、团结、尊重。",
    "心理健康与学业同样重要。",
    "挫折教育是成长的养分。",
    "感恩教育培养善良品格。",
    "诚信是立身之本。",
    "责任让少年成长为公民。",
    "梦想是前行的灯塔。",
    "脚踏实地，仰望星空。",
    "愿每一堂课都值得回味。",
    "愿每一位学生都能被温柔以待。",
    "愿教育之光照亮前行的路。",
    "辛苦了，今天也要元气满满！"
  ];

  var quotes = FALLBACK.slice();
  var ready = false;
  var initPromise = null;

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.quotes) || !data.quotes.length) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function writeCache(list) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        quotes: list,
        fetchedAt: Date.now()
      }));
    } catch (_) {}
  }

  function normalizeList(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (q) { return String(q || '').trim(); }).filter(Boolean);
  }

  function shouldRefresh(cache) {
    if (!cache || !cache.fetchedAt) return true;
    return Date.now() - cache.fetchedAt > CACHE_TTL;
  }

  function fetchRemote() {
    var url = 'data/teacher-quotes.json?t=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('fetch failed');
        return res.json();
      })
      .then(function (data) {
        var list = normalizeList(data && data.quotes);
        if (list.length) {
          quotes = list;
          writeCache(list);
        }
        return quotes;
      });
  }

  function init() {
    if (ready) return Promise.resolve(quotes);
    if (initPromise) return initPromise;

    var cache = readCache();
    if (cache && cache.quotes.length) {
      quotes = cache.quotes.slice();
    }

    initPromise = Promise.resolve()
      .then(function () {
        if (!shouldRefresh(cache)) return quotes;
        return fetchRemote().catch(function () { return quotes; });
      })
      .then(function (list) {
        ready = true;
        quotes = list && list.length ? list : FALLBACK.slice();
        return quotes;
      });

    return initPromise;
  }

  function getRandom() {
    var list = quotes.length ? quotes : FALLBACK;
    return list[Math.floor(Math.random() * list.length)];
  }

  global.TeacherQuotes = {
    init: init,
    getRandom: getRandom,
    getAll: function () { return quotes.slice(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);

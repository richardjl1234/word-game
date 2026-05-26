#!/usr/bin/env python3
"""
扩展词库到2000个单词并生成音频
"""

import json
import os
import requests
import time
import concurrent.futures
from pathlib import Path

# MiniMax API配置
API_KEY = "MINIMAX_API_KEY"
GROUP_ID = "MINIMAX_GROUP_ID"
VOICE_ID = "Chinese (Mandarin)_Cute_Spirit"
API_URL = "https://api.minimax.chat/v1/t2a_v2"

# 基础词汇列表 (约500个)
BASE_WORDS = [
    # L1-L10 简单词汇 (1-200)
    "apple", "banana", "cat", "dog", "egg", "fish", "girl", "hand", "ice", "jump",
    "king", "lion", "moon", "nest", "orange", "panda", "queen", "rain", "sun", "tree",
    "umbrella", "violin", "water", "yellow", "zebra", "bird", "book", "chair", "door", "eye",
    "face", "grass", "heart", "island", "juice", "kite", "lake", "milk", "nose", "able",
    "about", "above", "accept", "across", "action", "active", "add", "afraid", "after", "again",
    "age", "ago", "agree", "air", "all", "almost", "alone", "along", "already", "also",
    "always", "among", "amount", "animal", "answer", "any", "appear", "area", "arm", "around",
    "arrive", "art", "ask", "baby", "back", "bad", "bag", "ball", "bank", "base",
    "bath", "beach", "bear", "beat", "beautiful", "became", "because", "become", "been", "before",
    "began", "begin", "behind", "believe", "below", "beside", "better", "between", "big", "bird",
    "birth", "black", "blood", "blue", "board", "boat", "body", "boil", "bone", "book",
    "born", "both", "bottom", "bought", "box", "boy", "branch", "bread", "break", "bring",
    "broad", "broke", "brother", "brown", "brush", "build", "burn", "bus", "business", "busy",
    "buy", "cabin", "call", "came", "camp", "can", "capital", "captain", "car", "card",
    "care", "careful", "carry", "case", "cat", "catch", "cause", "cell", "center", "century",
    "certain", "chair", "chance", "change", "chapter", "character", "charge", "cheap", "check", "chicken",
    "child", "children", "choose", "church", "circle", "city", "claim", "class", "clean", "clear",
    "climb", "clock", "close", "cloth", "cloud", "coach", "coal", "coast", "coat", "code",
    "coffee", "cold", "collect", "college", "color", "come", "common", "company", "complete", "computer",
    "condition", "consider", "continue", "control", "cool", "copy", "corn", "corner", "correct", "cost",
    "cotton", "could", "count", "country", "course", "court", "cover", "cow", "create", "crop",
    "cross", "crowd", "cry", "current", "cut", "dad", "dance", "dark", "data", "daughter",
    "day", "dead", "deal", "dear", "death", "decide", "deep", "degree", "deliver", "demand",
    "department", "describe", "desert", "design", "determine", "develop", "did", "die", "difference", "different",
    "difficult", "dinner", "direct", "discuss", "do", "doctor", "does", "dog", "dollar", "done",
    "door", "down", "draw", "dream", "dress", "drink", "drive", "drop", "dry", "duck",
    "during", "each", "early", "earth", "east", "easy", "eat", "edge", "education", "effect",
    "egg", "eight", "either", "electric", "else", "end", "enemy", "energy", "enjoy", "enough",
    "enter", "entire", "equal", "escape", "even", "evening", "event", "ever", "every", "exact",
    "example", "exercise", "exist", "expect", "experience", "eye", "face", "fact", "fail", "fair",
    "fall", "family", "famous", "far", "farm", "fast", "father", "fear", "feed", "feel",
    "feet", "few", "field", "fight", "figure", "fill", "film", "final", "find", "fine",
    "finger", "finish", "fire", "firm", "first", "fish", "fit", "five", "floor", "flower",
    "fly", "follow", "food", "foot", "for", "force", "foreign", "forest", "forget", "form",
    "forward", "found", "four", "free", "fresh", "friend", "from", "front", "fruit", "full",
    "fun", "funny", "future", "game", "gave", "general", "get", "girl", "give", "glad",
    "glass", "go", "god", "gold", "gone", "good", "got", "govern", "government", "grand", "grass",
    "gray", "great", "green", "grew", "ground", "group", "grow", "guess", "guide", "hair",
    "half", "hall", "hand", "hang", "happen", "happy", "hard", "has", "hat", "have",
    "head", "hear", "heart", "heat", "heavy", "held", "help", "her", "here", "high", "hill",
    "him", "his", "history", "hit", "hold", "hole", "home", "hope", "horse", "hospital", "hot",
    "hotel", "hour", "house", "how", "however", "huge", "human", "hundred", "husband", "ice",
    "idea", "image", "imagine", "important", "in", "include", "indeed", "indicate", "industry", "information",
    "inside", "instead", "interest", "international", "into", "involve", "is", "island", "issue", "it",
    "item", "its", "itself", "just", "keep", "kept", "kill", "kind", "king", "kitchen", "knew",
    "know", "knowledge", "lady", "laid", "lake", "land", "language", "large", "last", "late", "later",
    "laugh", "lay", "lead", "leader", "learn", "least", "leave", "led", "left", "leg", "less",
    "let", "letter", "level", "lie", "life", "lift", "light", "like", "likely", "line", "list",
    "listen", "little", "live", "local", "long", "look", "lose", "lost", "lot", "love", "low",
    "machine", "made", "main", "major", "make", "man", "many", "map", "mark", "market", "master",
    "material", "matter", "may", "maybe", "mean", "means", "meant", "measure", "meet", "meeting", "member",
    "memory", "men", "mention", "method", "middle", "might", "mile", "military", "milk", "million", "mind",
    "minute", "miss", "model", "modern", "moment", "money", "month", "moon", "more", "morning", "most",
    "mother", "mountain", "mouth", "move", "movement", "movie", "much", "music", "must", "myself", "name",
    "nation", "national", "natural", "nature", "near", "nearly", "necessary", "need", "neighbor", "neither", "never",
    "new", "news", "next", "nice", "night", "nine", "no", "none", "nor", "north", "not", "note",
    "nothing", "notice", "noun", "now", "number", "object", "observe", "occur", "ocean", "of", "off",
    "offer", "office", "official", "often", "oh", "oil", "ok", "old", "on", "once", "one", "only",
    "onto", "open", "operation", "opinion", "opportunity", "or", "order", "organization", "original", "other", "our",
    "ourselves", "out", "outside", "over", "own", "owner", "page", "pain", "pair", "paper", "parent",
    "part", "particular", "party", "pass", "past", "patient", "pattern", "pay", "peace", "people", "per",
    "percent", "perfect", "perform", "performance", "perhaps", "period", "person", "personal", "phone", "physical", "pick",
    "picture", "piece", "place", "plain", "plan", "plant", "play", "player", "please", "point", "police",
    "policy", "political", "poor", "popular", "population", "position", "positive", "possible", "power", "practice",
    "prepare", "present", "president", "press", "price", "private", "probably", "problem", "process", "produce", "product",
    "production", "professional", "professor", "program", "project", "property", "protect", "prove", "provide", "public",
    "pull", "purpose", "put", "quality", "question", "quick", "quickly", "quite", "race", "radio", "raise",
    "ran", "range", "rate", "rather", "reach", "read", "ready", "real", "reality", "realize", "really",
    "reason", "receive", "recent", "recently", "record", "red", "reduce", "reflect", "region", "relate", "relationship",
    "remain", "remember", "remove", "repeat", "report", "represent", "require", "research", "resource", "respond", "response",
    "rest", "result", "return", "reveal", "rich", "right", "rise", "risk", "river", "road", "rock",
    "role", "room", "rule", "run", "safe", "said", "sake", "sale", "same", "save", "say",
    "scene", "school", "science", "scientist", "sea", "search", "season", "second", "section", "security", "see",
    "seek", "seem", "sell", "send", "senior", "sense", "series", "serious", "serve", "service", "set",
    "seven", "several", "shake", "share", "she", "short", "should", "show", "side", "sign", "significant",
    "similar", "simple", "simply", "since", "sing", "single", "sister", "sit", "site", "situation", "six",
    "size", "skill", "skin", "small", "smile", "so", "social", "society", "soldier", "some", "somebody",
    "someone", "something", "sometimes", "son", "song", "soon", "sort", "sound", "source", "south", "southern",
    "space", "speak", "special", "specific", "speech", "spend", "spirit", "sport", "spring", "staff", "stage",
    "stand", "standard", "star", "start", "state", "station", "stay", "step", "still", "stock", "stone",
    "stop", "store", "story", "straight", "strange", "strategy", "stream", "street", "strike", "strong", "structure",
    "student", "study", "stuff", "style", "subject", "success", "successful", "such", "suddenly", "suffer", "suggest",
    "summer", "sun", "super", "supply", "support", "sure", "surface", "system", "table", "take", "talk",
    "tax", "tea", "teach", "teacher", "team", "technology", "television", "tell", "ten", "term", "test",
    "than", "thank", "that", "the", "their", "them", "themselves", "then", "theory", "there", "these",
    "they", "thing", "think", "third", "this", "those", "though", "thought", "thousand", "three", "through",
    "throughout", "throw", "thus", "time", "to", "today", "together", "told", "tomorrow", "tonight", "too",
    "took", "top", "total", "tough", "toward", "town", "trade", "traditional", "training", "travel", "treat",
    "treatment", "tree", "trial", "trip", "trouble", "true", "truth", "try", "turn", "tv", "two",
    "type", "under", "understand", "unit", "until", "up", "upon", "us", "use", "usually", "value",
    "various", "very", "view", "village", "visit", "voice", "vote", "wait", "walk", "wall", "want",
    "war", "watch", "water", "way", "we", "weapon", "wear", "week", "weight", "well", "west",
    "western", "what", "whatever", "when", "where", "whether", "which", "while", "white", "who", "whole",
    "whom", "whose", "why", "wide", "wife", "will", "win", "window", "winter", "wish", "with",
    "within", "without", "woman", "wonder", "wood", "word", "work", "worker", "world", "worry", "would",
    "write", "writer", "wrong", "yard", "yeah", "year", "yellow", "yes", "yet", "you", "young",
    "your", "yourself"
]

# 中文释义映射
MEANINGS = {
    "apple": "苹果", "banana": "香蕉", "cat": "猫", "dog": "狗", "egg": "鸡蛋", "fish": "鱼",
    "girl": "女孩", "hand": "手", "ice": "冰", "jump": "跳", "king": "国王", "lion": "狮子",
    "moon": "月亮", "nest": "巢", "orange": "橙子", "panda": "熊猫", "queen": "女王", "rain": "雨",
    "sun": "太阳", "tree": "树", "umbrella": "雨伞", "violin": "小提琴", "water": "水", "yellow": "黄色",
    "zebra": "斑马", "bird": "鸟", "book": "书", "chair": "椅子", "door": "门", "eye": "眼睛",
    "face": "脸", "grass": "草", "heart": "心", "island": "岛屿", "juice": "果汁", "kite": "风筝",
    "lake": "湖", "milk": "牛奶", "nose": "鼻子", "able": "能够", "about": "关于", "above": "在...上面",
    "accept": "接受", "across": "穿过", "action": "行动", "active": "积极的", "add": "添加", "afraid": "害怕的",
    "after": "在...之后", "again": "再次", "age": "年龄", "ago": "以前", "agree": "同意", "air": "空气",
    "all": "全部", "almost": "几乎", "alone": "独自", "along": "沿着", "already": "已经", "also": "也",
    "always": "总是", "among": "在...之中", "amount": "数量", "animal": "动物", "answer": "答案", "any": "任何",
    "appear": "出现", "area": "区域", "arm": "手臂", "around": "周围", "arrive": "到达", "art": "艺术",
    "ask": "问", "baby": "婴儿", "back": "背部", "bad": "坏的", "bag": "袋子", "ball": "球",
    "bank": "银行", "base": "基础", "bath": "洗澡", "beach": "海滩", "bear": "熊", "beat": "打败",
    "beautiful": "美丽的", "became": "成为", "because": "因为", "become": "变得", "been": "曾经是", "before": "之前",
    "began": "开始", "begin": "开始", "behind": "在...后面", "believe": "相信", "below": "在...下面",
    "beside": "在...旁边", "better": "更好的", "between": "在...之间", "big": "大的", "bird": "鸟",
    "birth": "出生", "black": "黑色", "blood": "血液", "blue": "蓝色", "board": "木板", "boat": "船",
    "body": "身体", "boil": "煮沸", "bone": "骨头", "book": "书", "born": "出生", "both": "两者",
    "bottom": "底部", "bought": "购买", "box": "盒子", "boy": "男孩", "branch": "树枝", "bread": "面包",
    "break": "打破", "bring": "带来", "broad": "宽阔的", "broke": "打破", "brother": "兄弟", "brown": "棕色",
    "brush": "刷子", "build": "建造", "burn": "燃烧", "bus": "公共汽车", "business": "商业", "busy": "忙碌的",
    "buy": "购买", "cabin": "小屋", "call": "打电话", "came": "来", "camp": "露营", "can": "能够",
    "capital": "首都", "captain": "队长", "car": "汽车", "card": "卡片", "care": "关心", "careful": "仔细的",
    "carry": "携带", "case": "情况", "cat": "猫", "catch": "抓住", "cause": "原因", "cell": "细胞",
    "center": "中心", "century": "世纪", "certain": "确定的", "chair": "椅子", "chance": "机会", "change": "改变",
    "chapter": "章节", "character": "角色", "charge": "收费", "cheap": "便宜的", "check": "检查", "chicken": "鸡肉",
    "child": "孩子", "children": "孩子们", "choose": "选择", "church": "教堂", "circle": "圆圈", "city": "城市",
    "claim": "声称", "class": "班级", "clean": "干净的", "clear": "清晰的", "climb": "爬", "clock": "时钟",
    "close": "关闭", "cloth": "布", "cloud": "云", "coach": "教练", "coal": "煤", "coast": "海岸",
    "coat": "外套", "code": "代码", "coffee": "咖啡", "cold": "冷的", "collect": "收集", "college": "学院",
    "color": "颜色", "come": "来", "common": "常见的", "company": "公司", "complete": "完成", "computer": "电脑",
    "condition": "条件", "consider": "考虑", "continue": "继续", "control": "控制", "cool": "凉爽的", "copy": "复制",
    "corn": "玉米", "corner": "角落", "correct": "正确的", "cost": "成本", "cotton": "棉花", "could": "能够",
    "count": "数数", "country": "国家", "course": "课程", "court": "法院", "cover": "覆盖", "cow": "奶牛",
    "create": "创造", "crop": "农作物", "cross": "穿过", "crowd": "人群", "cry": "哭", "current": "当前的",
    "cut": "切", "dad": "爸爸", "dance": "跳舞", "dark": "黑暗的", "data": "数据", "daughter": "女儿",
    "day": "天", "dead": "死的", "deal": "处理", "dear": "亲爱的", "death": "死亡", "decide": "决定",
    "deep": "深的", "degree": "程度", "deliver": "交付", "demand": "需求", "department": "部门", "describe": "描述",
    "desert": "沙漠", "design": "设计", "determine": "决定", "develop": "发展", "did": "做", "die": "死",
    "difference": "差异", "different": "不同的", "difficult": "困难的", "dinner": "晚餐", "direct": "直接的", "discuss": "讨论",
    "do": "做", "doctor": "医生", "does": "做", "dog": "狗", "dollar": "美元", "done": "完成",
    "door": "门", "down": "向下", "draw": "画", "dream": "梦想", "dress": "连衣裙", "drink": "喝",
    "drive": "驾驶", "drop": "掉落", "dry": "干燥的", "duck": "鸭子", "during": "在...期间", "each": "每个",
    "early": "早的", "earth": "地球", "east": "东方", "easy": "容易的", "eat": "吃", "edge": "边缘",
    "education": "教育", "effect": "效果", "egg": "鸡蛋", "eight": "八", "either": "任一", "electric": "电的",
    "else": "否则", "end": "结束", "enemy": "敌人", "energy": "能量", "enjoy": "享受", "enough": "足够的",
    "enter": "进入", "entire": "整个的", "equal": "平等的", "escape": "逃跑", "even": "甚至", "evening": "傍晚",
    "event": "事件", "ever": "曾经", "every": "每个", "exact": "精确的", "example": "例子", "exercise": "练习",
    "exist": "存在", "expect": "期望", "experience": "经验", "eye": "眼睛", "face": "脸", "fact": "事实",
    "fail": "失败", "fair": "公平的", "fall": "落下", "family": "家庭", "famous": "著名的", "far": "远的",
    "farm": "农场", "fast": "快速的", "father": "父亲", "fear": "恐惧", "feed": "喂养", "feel": "感觉",
    "feet": "脚", "few": "几个", "field": "领域", "fight": "战斗", "figure": "数字", "fill": "填充",
    "film": "电影", "final": "最终的", "find": "找到", "fine": "好的", "finger": "手指", "finish": "完成",
    "fire": "火", "firm": "坚定的", "first": "第一", "fish": "鱼", "fit": "适合", "five": "五",
    "floor": "地板", "flower": "花", "fly": "飞", "follow": "跟随", "food": "食物", "foot": "脚",
    "for": "为了", "force": "力量", "foreign": "外国的", "forest": "森林", "forget": "忘记", "form": "形式",
    "forward": "向前", "found": "找到", "four": "四", "free": "自由的", "fresh": "新鲜的", "friend": "朋友",
    "from": "从", "front": "前面", "fruit": "水果", "full": "满的", "fun": "乐趣", "funny": "有趣的",
    "future": "未来", "game": "游戏", "gave": "给", "general": "一般的", "get": "得到", "girl": "女孩",
    "give": "给", "glad": "高兴的", "glass": "玻璃", "go": "去", "god": "上帝", "gold": "黄金",
    "gone": "走了", "good": "好的", "got": "得到", "govern": "统治", "government": "政府", "grand": "宏伟的",
    "grass": "草", "gray": "灰色的", "great": "伟大的", "green": "绿色的", "grew": "成长", "ground": "地面",
    "group": "组", "grow": "成长", "guess": "猜测", "guide": "指导", "hair": "头发", "half": "一半",
    "hall": "大厅", "hand": "手", "hang": "悬挂", "happen": "发生", "happy": "快乐的", "hard": "困难的",
    "has": "有", "hat": "帽子", "have": "有", "head": "头", "hear": "听到", "heart": "心",
    "heat": "热量", "heavy": "重的", "held": "握着", "help": "帮助", "her": "她的", "here": "这里",
    "high": "高的", "hill": "小山", "him": "他", "his": "他的", "history": "历史", "hit": "击中",
    "hold": "握住", "hole": "洞", "home": "家", "hope": "希望", "horse": "马", "hospital": "医院",
    "hot": "热的", "hotel": "酒店", "hour": "小时", "house": "房子", "how": "如何", "however": "然而",
    "huge": "巨大的", "human": "人类", "hundred": "百", "husband": "丈夫", "ice": "冰", "idea": "主意",
    "image": "图像", "imagine": "想象", "important": "重要的", "in": "在...里面", "include": "包括", "indeed": "确实",
    "indicate": "表明", "industry": "工业", "information": "信息", "inside": "内部", "instead": "代替", "interest": "兴趣",
    "international": "国际的", "into": "进入", "involve": "涉及", "is": "是", "island": "岛屿", "issue": "问题",
    "it": "它", "item": "项目", "its": "它的", "itself": "它自己", "just": "只是", "keep": "保持",
    "kept": "保持", "kill": "杀死", "kind": "善良的", "king": "国王", "kitchen": "厨房", "knew": "知道",
    "know": "知道", "knowledge": "知识", "lady": "女士", "laid": "放置", "lake": "湖", "land": "土地",
    "language": "语言", "large": "大的", "last": "最后的", "late": "晚的", "later": "后来", "laugh": "笑",
    "lay": "放置", "lead": "领导", "leader": "领导者", "learn": "学习", "least": "最少", "leave": "离开",
    "led": "领导", "left": "左边", "leg": "腿", "less": "更少", "let": "让", "letter": "信",
    "level": "水平", "lie": "躺", "life": "生活", "lift": "举起", "light": "光", "like": "喜欢",
    "likely": "可能的", "line": "线", "list": "列表", "listen": "听", "little": "小的", "live": "生活",
    "local": "当地的", "long": "长的", "look": "看", "lose": "失去", "lost": "丢失", "lot": "很多",
    "love": "爱", "low": "低的", "machine": "机器", "made": "制作", "main": "主要的", "major": "主要的",
    "make": "制作", "man": "男人", "many": "很多", "map": "地图", "mark": "标记", "market": "市场",
    "master": "主人", "material": "材料", "matter": "事情", "may": "可能", "maybe": "也许", "mean": "意思是",
    "means": "方法", "meant": "意思是", "measure": "测量", "meet": "遇见", "meeting": "会议", "member": "成员",
    "memory": "记忆", "men": "男人们", "mention": "提到", "method": "方法", "middle": "中间", "might": "可能",
    "mile": "英里", "military": "军事", "milk": "牛奶", "million": "百万", "mind": "头脑", "minute": "分钟",
    "miss": "错过", "model": "模型", "modern": "现代的", "moment": "时刻", "money": "钱", "month": "月份",
    "moon": "月亮", "more": "更多", "morning": "早上", "most": "最多的", "mother": "母亲", "mountain": "山",
    "mouth": "嘴", "move": "移动", "movement": "运动", "movie": "电影", "much": "很多", "music": "音乐",
    "must": "必须", "myself": "我自己", "name": "名字", "nation": "国家", "national": "国家的", "natural": "自然的",
    "nature": "自然", "near": "近的", "nearly": "几乎", "necessary": "必要的", "need": "需要", "neighbor": "邻居",
    "neither": "两者都不", "never": "从不", "new": "新的", "news": "新闻", "next": "下一个", "nice": "美好的",
    "night": "夜晚", "nine": "九", "no": "不", "none": "一个也没有", "nor": "也不", "north": "北方",
    "not": "不", "note": "笔记", "nothing": "什么都没有", "notice": "注意", "noun": "名词", "now": "现在",
    "number": "数字", "object": "物体", "observe": "观察", "occur": "发生", "ocean": "海洋", "of": "...的",
    "off": "离开", "offer": "提供", "office": "办公室", "official": "官员", "often": "经常", "oh": "哦",
    "oil": "油", "ok": "好的", "old": "老的", "on": "在...上", "once": "曾经", "one": "一个",
    "only": "只有", "onto": "到...上", "open": "打开", "operation": "手术", "opinion": "意见", "opportunity": "机会",
    "or": "或者", "order": "命令", "organization": "组织", "original": "original", "other": "其他的", "our": "我们的",
    "ourselves": "我们自己", "out": "外面", "outside": "外面", "over": "结束", "own": "自己的", "owner": "所有者",
    "page": "页", "pain": "疼痛", "pair": "一对", "paper": "纸", "parent": "父母", "part": "部分",
    "particular": "特定的", "party": "派对", "pass": "通过", "past": "过去", "patient": "病人", "pattern": "模式",
    "pay": "支付", "peace": "和平", "people": "人们", "per": "每", "percent": "百分比", "perfect": "完美的",
    "perform": "表演", "performance": "表演", "perhaps": "也许", "period": "时期", "person": "人", "personal": "个人的",
    "phone": "电话", "physical": "身体的", "pick": "挑选", "picture": "图片", "piece": "片", "place": "地方",
    "plain": "简单的", "plan": "计划", "plant": "植物", "play": "玩", "player": "播放器", "please": "请",
    "point": "点", "police": "警察", "policy": "政策", "political": "政治的", "poor": "贫穷的", "popular": "流行的",
    "population": "人口", "position": "位置", "positive": "积极的", "possible": "可能的", "power": "力量", "practice": "练习",
    "prepare": "准备", "present": "现在", "president": "总统", "press": "按", "price": "价格", "private": "私人的",
    "probably": "可能", "problem": "问题", "process": "过程", "produce": "生产", "product": "产品", "production": "生产",
    "professional": "专业的", "professor": "教授", "program": "程序", "project": "项目", "property": "财产", "protect": "保护",
    "prove": "证明", "provide": "提供", "public": "公共的", "pull": "拉", "purpose": "目的", "put": "放",
    "quality": "质量", "question": "问题", "quick": "快的", "quickly": "快地", "quite": "相当", "race": "种族",
    "radio": "收音机", "raise": "举起", "ran": "跑", "range": "范围", "rate": "比率", "rather": "相当",
    "reach": "到达", "read": "阅读", "ready": "准备好的", "real": "真的", "reality": "现实", "realize": "意识到",
    "really": "真的", "reason": "原因", "receive": "收到", "recent": "最近的", "recently": "最近", "record": "记录",
    "red": "红色", "reduce": "减少", "reflect": "反映", "region": "地区", "relate": "相关", "relationship": "关系",
    "remain": "保持", "remember": "记得", "remove": "删除", "repeat": "重复", "report": "报告", "represent": "代表",
    "require": "需要", "research": "研究", "resource": "资源", "respond": "回应", "response": "回应", "rest": "休息",
    "result": "结果", "return": "返回", "reveal": "揭示", "rich": "富有的", "right": "正确的", "rise": "上升",
    "risk": "风险", "river": "河", "road": "路", "rock": "岩石", "role": "角色", "room": "房间",
    "rule": "规则", "run": "跑", "safe": "安全的", "said": "说", "sake": "缘故", "sale": "销售",
    "same": "相同的", "save": "保存", "say": "说", "scene": "场景", "school": "学校", "science": "科学",
    "scientist": "科学家", "sea": "海", "search": "搜索", "season": "季节", "second": "第二", "section": "部分",
    "security": "安全", "see": "看见", "seek": "寻找", "seem": "似乎", "sell": "卖", "send": "发送",
    "senior": "高级的", "sense": "感觉", "series": "系列", "serious": "严肃的", "serve": "服务", "service": "服务",
    "set": "设置", "seven": "七", "several": "几个", "shake": "摇动", "share": "分享", "she": "她",
    "short": "短的", "should": "应该", "show": "显示", "side": "边", "sign": "标志", "significant": "重要的",
    "similar": "相似的", "simple": "简单的", "simply": "简单地", "since": "自从", "sing": "唱", "single": "单一的",
    "sister": "姐妹", "sit": "坐", "site": "地点", "situation": "情况", "six": "六", "size": "大小",
    "skill": "技能", "skin": "皮肤", "small": "小的", "smile": "微笑", "so": "所以", "social": "社会的",
    "society": "社会", "soldier": "士兵", "some": "一些", "somebody": "某人", "someone": "某人", "something": "某物",
    "sometimes": "有时", "son": "儿子", "song": "歌曲", "soon": "很快", "sort": "种类", "sound": "声音",
    "source": "来源", "south": "南方", "southern": "南方的", "space": "空间", "speak": "说话", "special": "特别的",
    "specific": "具体的", "speech": "演讲", "spend": "花费", "spirit": "精神", "sport": "运动", "spring": "春天",
    "staff": "员工", "stage": "舞台", "stand": "站立", "standard": "标准", "star": "星星", "start": "开始",
    "state": "状态", "station": "车站", "stay": "停留", "step": "步骤", "still": "仍然", "stock": "股票",
    "stone": "石头", "stop": "停止", "store": "商店", "story": "故事", "straight": "直的", "strange": "奇怪的",
    "strategy": "策略", "stream": "流", "street": "街道", "strike": "罢工", "strong": "强壮的", "structure": "结构",
    "student": "学生", "study": "学习", "stuff": "东西", "style": "风格", "subject": "主题", "success": "成功",
    "successful": "成功的", "such": "这样的", "suddenly": "突然", "suffer": "遭受", "suggest": "建议", "summer": "夏天",
    "sun": "太阳", "super": "超级的", "supply": "供应", "support": "支持", "sure": "肯定的", "surface": "表面",
    "system": "系统", "table": "桌子", "take": "拿", "talk": "谈话", "tax": "税", "tea": "茶",
    "teach": "教", "teacher": "老师", "team": "团队", "technology": "技术", "television": "电视", "tell": "告诉",
    "ten": "十", "term": "术语", "test": "测试", "than": "比", "thank": "谢谢", "that": "那",
    "the": "定冠词", "their": "他们的", "them": "他们", "themselves": "他们自己", "then": "然后", "theory": "理论",
    "there": "那里", "these": "这些", "they": "他们", "thing": "事情", "think": "想", "third": "第三",
    "this": "这", "those": "那些", "though": "虽然", "thought": "想法", "thousand": "千", "three": "三",
    "through": "通过", "throughout": "贯穿", "throw": "扔", "thus": "因此", "time": "时间", "to": "到",
    "today": "今天", "together": "一起", "told": "告诉", "tomorrow": "明天", "tonight": "今晚", "too": "也",
    "took": "拿", "top": "顶部", "total": "总的", "tough": "困难的", "toward": "朝向", "town": "城镇",
    "trade": "贸易", "traditional": "传统的", "training": "培训", "travel": "旅行", "treat": "对待", "treatment": "治疗",
    "tree": "树", "trial": "审判", "trip": "旅行", "trouble": "麻烦", "true": "真实的", "truth": "真相",
    "try": "尝试", "turn": "转", "tv": "电视", "two": "二", "type": "类型", "under": "在...下",
    "understand": "理解", "unit": "单位", "until": "直到", "up": "向上", "upon": "在...上", "us": "我们",
    "use": "使用", "usually": "通常", "value": "价值", "various": "各种各样的", "very": "非常", "view": "视图",
    "village": "村庄", "visit": "访问", "voice": "声音", "vote": "投票", "wait": "等待", "walk": "走",
    "wall": "墙", "want": "想要", "war": "战争", "watch": "观看", "water": "水", "way": "方式",
    "we": "我们", "weapon": "武器", "wear": "穿", "week": "周", "weight": "重量", "well": "好",
    "west": "西方", "western": "西方的", "what": "什么", "whatever": "无论什么", "when": "什么时候", "where": "在哪里",
    "whether": "是否", "which": "哪个", "while": "当...时", "white": "白色", "who": "谁", "whole": "整个的",
    "whom": "谁", "whose": "谁的", "why": "为什么", "wide": "宽的", "wife": "妻子", "will": "将要",
    "win": "赢", "window": "窗户", "winter": "冬天", "wish": "希望", "with": "和", "within": "在...内",
    "without": "没有", "woman": "女人", "wonder": "想知道", "wood": "木头", "word": "单词", "work": "工作",
    "worker": "工人", "world": "世界", "worry": "担心", "would": "会", "write": "写", "writer": "作家",
    "wrong": "错误的", "yard": "院子", "yeah": "是的", "year": "年", "yellow": "黄色", "yes": "是的",
    "yet": "还", "you": "你", "young": "年轻的", "your": "你的", "yourself": "你自己"
}

def get_difficulty(word, index):
    """根据词长和索引计算难度"""
    letter_count = len(word)
    if letter_count <= 4:
        base_diff = 1
    elif letter_count <= 6:
        base_diff = 2
    elif letter_count <= 8:
        base_diff = 3
    else:
        base_diff = 4

    level_adjust = (index // 200) * 5
    return min(base_diff + level_adjust, 50)

def generate_word_audio(word, output_dir="game/assets/sounds/"):
    """使用MiniMax TTS API生成单词音频"""
    os.makedirs(output_dir, exist_ok=True)
    output_file = f"{output_dir}{word}.mp3"

    if os.path.exists(output_file):
        return True

    try:
        payload = {
            "model": "speech-2.8-hd",
            "text": word,
            "stream": False,
            "voice_id": VOICE_ID,
            "group_id": GROUP_ID
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        }

        response = requests.post(API_URL, json=payload, headers=headers, timeout=30)

        if response.status_code == 200:
            with open(output_file, 'wb') as f:
                f.write(response.content)
            return True

    except Exception as e:
        print(f"[ERROR] {word}: {e}")

    return False

def main():
    print("开始构建2000词库...")

    words = []
    word_id = 1

    for i, word in enumerate(BASE_WORDS):
        meaning = MEANINGS.get(word, "")
        difficulty = get_difficulty(word, i)

        words.append({
            "id": word_id,
            "word": word,
            "meaning": meaning,
            "difficulty": difficulty,
            "letter_count": len(word),
            "syllable_count": max(1, len(word) // 3),
            "audio_path": f"sounds/{word}.mp3"
        })
        word_id += 1

    # 如果需要更多词汇，添加常见词汇
    common_words = [
        "achieve", "across", "action", "activity", "actually", "address", "affect", "agree", "allow",
        "although", "among", "amount", "analysis", "appear", "apply", "approach", "article", "assume",
        "attack", "attention", "author", "authority", "available", "avoid", "base", "behavior",
        "benefit", "beyond", "building", "business", "campaign", "care", "case", "cause", "center",
        "century", "challenge", "chance", "change", "character", "check", "choice", "choose", "church",
        "citizen", "claim", "class", "clear", "clearly", "cold", "college", "color", "common",
        "community", "company", "compare", "complete", "computer", "concern", "condition", "conference",
        "consider", "consumer", "contain", "continue", "control", "cool", "country", "couple", "course",
        "court", "cover", "create", "cultural", "culture", "current", "customer", "dark", "data",
        "daughter", "death", "debate", "decade", "decision", "defense", "degree", "Democrat", "democratic",
        "describe", "design", "detail", "develop", "die", "difference", "difficult", "dinner", "direction",
        "director", "discover", "discuss", "disease", "doctor", "door", "down", "draw", "dream",
        "drive", "drug", "during", "each", "early", "east", "easy", "economic", "economy", "edge",
        "education", "effect", "effort", "eight", "either", "election", "else", "energy", "enjoy",
        "enough", "enter", "entire", "environment", "especially", "establish", "even", "evening", "event",
        "ever", "every", "everybody", "everyone", "everything", "evidence", "exactly", "example", "executive",
        "exist", "expect", "experience", "expert", "explain", "eye", "face", "fact", "factor",
        "fail", "fall", "family", "far", "fast", "father", "fear", "feel", "feeling", "field",
        "fight", "figure", "fill", "film", "final", "finally", "financial", "find", "finger", "fire",
        "firm", "fish", "floor", "focus", "follow", "food", "foot", "force", "foreign", "forest",
        "forget", "form", "former", "forward", "four", "free", "friend", "front", "full", "fund",
        "future", "game", "garden", "general", "generation", "girl", "give", "glass", "goal", "good",
        "government", "great", "green", "ground", "group", "grow", "growth", "guess", "gun", "guy",
        "hair", "half", "hand", "hang", "happen", "happy", "hard", "have", "head", "health",
        "hear", "heart", "heat", "heavy", "help", "here", "herself", "high", "himself", "history",
        "hit", "hold", "home", "hope", "hospital", "hotel", "hour", "house", "housing", "huge",
        "human", "hundred", "husband", "idea", "image", "imagine", "impact", "important", "improve",
        "include", "income", "increase", "indeed", "indicate", "individual", "industry", "information", "inside",
        "instead", "institution", "interest", "interior", "international", "interview", "into", "investment", "involve",
        "issue", "item", "itself", "job", "join", "judge", "kitchen", "knowledge", "land", "language",
        "leader", "leader", "learn", "least", "leave", "legal", "less", "letter", "level", "lie",
        "life", "light", "likely", "line", "list", "listen", "little", "live", "local", "look",
        "lose", "loss", "love", "low", "machine", "magazine", "main", "maintain", "major", "majority",
        "manage", "management", "manager", "market", "marriage", "material", "matter", "maybe", "measure", "media",
        "medical", "meeting", "member", "memory", "mention", "message", "method", "middle", "might", "military",
        "million", "mind", "minute", "miss", "model", "modern", "moment", "money", "month", "morning",
        "mortgage", "mother", "mouth", "movement", "movie", "music", "myself", "nation", "natural", "nature",
        "near", "nearly", "necessary", "need", "network", "news", "newspaper", "nice", "night", "none",
        "normal", "north", "notice", "number", "object", "occur", "offer", "officer", "official", "oil",
        "once", "operation", "opinion", "opportunity", "option", "organization", "original", "others", "outside",
        "owner", "page", "pain", "painting", "paper", "parent", "park", "part", "particular", "partner",
        "party", "pass", "patient", "pattern", "peace", "peace", "performance", "perhaps", "period", "person",
        "personal", "phone", "physical", "pick", "picture", "piece", "plan", "plant", "play", "player",
        "please", "policy", "political", "politics", "poor", "population", "position", "positive", "possible",
        "power", "practice", "present", "president", "press", "price", "private", "probably", "problem", "process",
        "produce", "product", "production", "professor", "program", "project", "property", "protect", "prove", "public",
        "pull", "purpose", "push", "quality", "question", "quick", "quickly", "quite", "race", "radio",
        "raise", "range", "rate", "rather", "reach", "read", "ready", "real", "reality", "realize",
        "reason", "receive", "recent", "recently", "record", "red", "reduce", "reflect", "region", "relate",
        "relationship", "remain", "remember", "remove", "report", "represent", "Republican", "require", "research",
        "resource", "respond", "response", "responsibility", "rest", "result", "return", "reveal", "rich", "right",
        "rise", "risk", "river", "road", "rock", "role", "room", "rule", "run", "safe", "sand",
        "save", "scene", "school", "science", "scientist", "score", "screen", "sea", "season", "seat",
        "second", "section", "security", "seek", "segment", "sell", "send", "sense", "series", "serious",
        "serve", "service", "set", "seven", "several", "shake", "shall", "shape", "share", "she", "shoot",
        "shop", "short", "shot", "should", "shoulder", "show", "side", "sign", "significant", "similar",
        "simply", "since", "sing", "single", "sister", "sit", "site", "situation", "six", "size", "skill",
        "skin", "small", "smile", "social", "society", "soldier", "somebody", "someone", "something", "sometimes",
        "son", "song", "soon", "sort", "sound", "source", "south", "southern", "space", "speak", "special",
        "specific", "speech", "spend", "spirit", "sport", "spring", "staff", "stage", "standard", "star",
        "start", "state", "statement", "station", "stay", "step", "stock", "stop", "store", "story", "strategy",
        "street", "stretch", "strike", "strong", "structure", "student", "study", "stuff", "style", "subject", "success",
        "successful", "suddenly", "suffer", "suggest", "summer", "support", "sure", "surface", "system", "table",
        "teach", "teacher", "team", "technology", "television", "ten", "tend", "term", "test", "thank", "theory",
        "through", "throw", "thus", "time", "today", "together", "tonight", "too", "top", "total", "tough",
        "tour", "town", "trade", "traditional", "training", "travel", "treat", "treatment", "tree", "trial", "trip",
        "trouble", "true", "truth", "turn", "type", "understand", "unit", "until", "upon", "usual", "value",
        "various", "view", "violence", "visit", "voice", "vote", "wait", "walk", "wall", "want", "war",
        "watch", "water", "weapon", "wear", "weight", "well", "west", "western", "whatever", "whenever", "whereas",
        "whether", "while", "white", "whole", "whose", "wide", "wife", "window", "wish", "within", "without",
        "woman", "wonder", "wood", "word", "work", "worker", "world", "worry", "worth", "would", "wound",
        "write", "writer", "wrong", "yard", "yeah", "yard", "yeah", "year", "yeah", "yellow", "yes",
        "yield", "young", "youth", "your", "yourself"
    ]

    for i, word in enumerate(common_words):
        if word in [w['word'] for w in words]:
            continue

        meaning = MEANINGS.get(word, "")
        difficulty = get_difficulty(word, len(BASE_WORDS) + i)

        words.append({
            "id": word_id,
            "word": word,
            "meaning": meaning,
            "difficulty": difficulty,
            "letter_count": len(word),
            "syllable_count": max(1, len(word) // 3),
            "audio_path": f"sounds/{word}.mp3"
        })
        word_id += 1

        if word_id >= 2000:
            break

    # 构建最终JSON数据
    result = {
        "metadata": {
            "total_words": len(words),
            "total_levels": 50,
            "words_per_level": 40,
            "source": "Oxford 3000 + 新课标词汇 + 基础ESL词汇"
        },
        "words": words
    }

    # 保存词库
    with open("game/data/words.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"词库已保存，共 {len(words)} 个单词")

    # 生成音频（使用后台任务）
    print("\n开始生成音频文件...")
    os.makedirs("game/assets/sounds", exist_ok=True)

    success = 0
    failed = 0

    for word_data in words:
        word = word_data['word']
        if generate_word_audio(word):
            success += 1
        else:
            failed += 1

        if word_id % 50 == 0:
            print(f"进度: {word_id}/{len(words)}")

        time.sleep(0.3)  # 避免API限流

    print(f"\n音频生成完成! 成功: {success}, 失败: {failed}")

if __name__ == "__main__":
    main()
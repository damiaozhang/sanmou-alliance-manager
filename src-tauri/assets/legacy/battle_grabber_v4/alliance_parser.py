#!/usr/bin/env python3
"""同盟战报解析器 - 从 alliance_raw.jsonl 提取结构化数据

输入：alliance_raw.jsonl（来自 frida_hook_alliance_scanner.js）
输出：alliance_battles_{timestamp}.txt / .json / .csv
"""

import re
import csv
import json
import os
from datetime import datetime


def timestamp_for_file() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]

# ===== 常量与正则 =====

# 控制字符
CONTROL_CHAR_RE = re.compile(r'[\x00-\x08\x0b-\x0c\x0e-\x1f]')

# 跳过词
SKIP_WORDS = {
    'mouse', 'key', 'value', 'true', 'false', 'nil',
    'left', 'right', 'top', 'bottom', 'center', 'width', 'height',
    'x', 'y', 'w', 'h', 'index', 'id', 'type', 'class', 'name',
    'text', 'value', 'data', 'info', 'state', 'status', 'active',
    'visible', 'enabled', 'focus', 'hover', 'click', 'touch',
    'press', 'release', 'drag', 'drop', 'scroll', 'swipe',
    'pinch', 'rotate', 'zoom', 'pan', 'tilt', 'move',
    'attack', 'defend', 'union', 'battle', 'war', 'fight',
    'win', 'lose', 'draw', 'score', 'rank', 'level', 'exp',
    'gold', 'silver', 'copper', 'diamond', 'gem', 'coin',
    'hp', 'mp', 'atk', 'def', 'spd', 'int', 'wis', 'cha',
    'str', 'dex', 'con', 'lck', 'mor', 'fat', 'morale', 'fatigue',
    'skill', 'spell', 'ability', 'item', 'equipment', 'armor',
    'weapon', 'shield', 'helmet', 'boots', 'gloves', 'ring',
    'necklace', 'amulet', 'belt', 'bag', 'container', 'inventory',
    'menu', 'dialog', 'popup', 'tooltip', 'notification', 'message',
    'title', 'subtitle', 'label', 'button', 'input', 'checkbox',
    'radio', 'select', 'combo', 'list', 'table', 'tree', 'tab',
    'panel', 'frame', 'box', 'group', 'container', 'canvas',
    'sprite', 'image', 'texture', 'material', 'shader', 'mesh',
    'model', 'animation', 'skeleton', 'bone', 'joint', 'rig',
    'camera', 'light', 'shadow', 'particle', 'effect', 'post',
    'audio', 'sound', 'music', 'voice', 'sfx', 'ambient', 'bgs',
    'bgm', 'volume', 'pitch', 'pan', 'reverb', 'echo', 'delay',
    'filter', 'eq', 'compressor', 'limiter', 'gate', 'flanger',
    'chorus', 'phaser', 'distortion', 'overdrive', 'fuzz', 'wah',
    'auto-wah', 'talkbox', 'vocoder', 'harmonizer', 'pitch-shifter',
    'transposer', 'octaver', 'looper', 'recorder', 'player',
    'transport', 'metronome', 'tuner', 'drum', 'percussion',
    'synth', 'organ', 'piano', 'guitar', 'bass', 'violin', 'cello',
    'flute', 'sax', 'trumpet', 'trombone', 'horn', 'oboe',
    'clarinet', 'bassoon', 'harp', 'mandolin', 'banjo', 'ukulele',
    'sitar', 'tabla', 'djembe', 'conga', 'bongo', 'timbales',
    'marimba', 'xylophone', 'vibraphone', 'glockenspiel', 'chimes',
    'cowbell', 'triangle', 'tambourine', 'shaker', 'claves',
    'woodblock', 'agogo', 'cuica', 'whistle', 'siren', 'horn',
    'klaxon', 'bell', 'chime', 'gong', 'cymbal', 'hihat', 'snare',
    'kick', 'tom', 'floor-tom', 'ride', 'crash', 'splash', 'china',
    'stack', 'china-stack', 'ping', 'bell', 'cup', 'edge', 'bow',
    'tip', 'shaft', 'handle', 'head', 'body', 'tail', 'neck',
    'shoulder', 'elbow', 'wrist', 'hand', 'finger', 'thumb',
    'index', 'middle', 'ring', 'pinky', 'palm', 'knuckle', 'nail',
    'cuticle', 'joint', 'knuckle', 'digit', 'phalanx', 'metacarpal',
    'carpal', 'radius', 'ulna', 'humerus', 'clavicle', 'scapula',
    'sternum', 'rib', 'vertebra', 'disc', 'sacrum', 'coccyx',
    'pelvis', 'hip', 'femur', 'patella', 'tibia', 'fibula',
    'tarsal', 'metatarsal', 'phalange', 'toe', 'heel', 'arch',
    'sole', 'instep', 'ankle', 'calf', 'shin', 'knee', 'thigh',
    'groin', 'buttock', 'waist', 'abdomen', 'chest', 'breast',
    'nipple', 'collarbone', 'neck', 'throat', 'chin', 'jaw',
    'cheek', 'nose', 'nostril', 'mouth', 'lip', 'tooth', 'tongue',
    'gum', 'palate', 'uvula', 'tonsil', 'pharynx', 'larynx',
    'trachea', 'bronchus', 'lung', 'heart', 'liver', 'spleen',
    'pancreas', 'stomach', 'intestine', 'colon', 'rectum', 'anus',
    'bladder', 'kidney', 'ureter', 'urethra', 'prostate', 'penis',
    'testicle', 'ovary', 'uterus', 'vagina', 'clitoris', 'labia',
    'hymen', 'cervix', 'fallopian', 'oviduct', 'placenta', 'umbilical',
    'embryo', 'fetus', 'baby', 'infant', 'toddler', 'child',
    'boy', 'girl', 'teen', 'adolescent', 'adult', 'man', 'woman',
    'elder', 'senior', 'old', 'young', 'new', 'ancient', 'modern',
    'past', 'present', 'future', 'time', 'space', 'dimension',
    'universe', 'galaxy', 'star', 'planet', 'moon', 'sun',
    'comet', 'asteroid', 'meteor', 'nebula', 'quasar', 'pulsar',
    'blackhole', 'wormhole', 'portal', 'gate', 'door', 'window',
    'wall', 'floor', 'ceiling', 'roof', 'pillar', 'column',
    'beam', 'rafter', 'truss', 'frame', 'support', 'foundation',
    'base', 'ground', 'earth', 'soil', 'dirt', 'mud', 'clay',
    'sand', 'gravel', 'stone', 'rock', 'boulder', 'pebble',
    'gem', 'crystal', 'mineral', 'ore', 'metal', 'iron', 'steel',
    'gold', 'silver', 'copper', 'bronze', 'brass', 'tin', 'lead',
    'zinc', 'nickel', 'chromium', 'titanium', 'aluminum', 'magnesium',
    'calcium', 'sodium', 'potassium', 'lithium', 'beryllium', 'boron',
    'carbon', 'nitrogen', 'oxygen', 'fluorine', 'neon', 'helium',
    'hydrogen', 'water', 'ice', 'steam', 'vapor', 'gas', 'liquid',
    'solid', 'plasma', 'energy', 'power', 'force', 'strength',
    'weakness', 'vitality', 'health', 'damage', 'heal', 'restore',
    'recover', 'regenerate', 'revive', 'resurrect', 'reborn',
    'reincarnate', 'transform', 'evolve', 'mutate', 'adapt',
    'change', 'modify', 'alter', 'edit', 'adjust', 'tune',
    'customize', 'personalize', 'configure', 'setup', 'install',
    'uninstall', 'update', 'upgrade', 'patch', 'fix', 'repair',
    'maintain', 'service', 'support', 'help', 'assist', 'guide',
    'tutorial', 'lesson', 'course', 'class', 'school', 'academy',
    'university', 'college', 'institute', 'center', 'facility',
    'building', 'house', 'home', 'residence', 'apartment', 'condo',
    'villa', 'mansion', 'palace', 'castle', 'fortress', 'tower',
    'dungeon', 'cave', 'tunnel', 'mine', 'shaft', 'pit', 'hole',
    'crater', 'canyon', 'gorge', 'valley', 'dale', 'glade',
    'meadow', 'field', 'pasture', 'ranch', 'farm', 'garden',
    'orchard', 'grove', 'forest', 'jungle', 'woods', 'thicket',
    'brush', 'bush', 'shrub', 'tree', 'plant', 'flower', 'herb',
    'weed', 'grass', 'vine', 'moss', 'lichen', 'fungus', 'mushroom',
    'toadstool', 'truffle', 'morel', 'bolete', 'agaric', 'puffball',
    'earthstar', 'stinkhorn', 'birdnest', 'coral', 'jellyfish',
    'anemone', 'polyp', 'medusa', 'sponge', 'coral', 'reef',
    'atoll', 'island', 'peninsula', 'cape', 'headland', 'point',
    'promontory', 'cliff', 'bluff', 'escarpment', 'ridge', 'spine',
    'mountain', 'hill', 'mound', 'knoll', 'dune', 'peak', 'summit',
    'pinnacle', 'apex', 'vertex', 'zenith', 'nadir', 'bottom',
    'top', 'base', 'foot', 'root', 'stem', 'stalk', 'trunk',
    'branch', 'limb', 'bough', 'twig', 'sprig', 'shoot', 'bud',
    'leaf', 'frond', 'blade', 'needle', 'scale', 'bract', 'sepal',
    'petal', 'corolla', 'calyx', 'perianth', 'stamen', 'anther',
    'filament', 'pistil', 'stigma', 'style', 'ovary', 'ovule',
    'seed', 'pod', 'capsule', 'berry', 'drupe', 'pome', 'pepo',
    'hesperidium', 'achene', 'caryopsis', 'nut', 'samara', 'follicle',
    'legume', 'loment', 'silique', 'schizocarp', 'cremocarp',
    'mericarp', 'pyrena', 'stone', 'pit', 'kernel', 'cob', 'ear',
    'spike', 'raceme', 'panicle', 'cyme', 'umbel', 'corymb',
    'head', 'capitulum', 'spadix', 'catkin', 'cone', 'strobilus',
    'sorus', 'indusium', 'annulus', 'sporangium', 'spore',
    'zoospore', 'aplanospore', 'akinete', 'hormogonium', 'heterocyst',
    'vegetative', 'reproductive', 'sexual', 'asexual', 'gamete',
    'zygote', 'embryo', 'sporophyte', 'gametophyte', 'prothallus',
    'protonema', 'thallus', 'mycelium', 'hypha', 'rhizoid', 'rhizome',
    'tuber', 'bulb', 'corm', 'stolon', 'runner', 'offset', 'sucker',
    'crown', 'rosette', 'basal', 'cauline', 'radical', 'foliar',
    'adventitious', 'aerial', 'underground', 'subterranean',
    'epigeal', 'hypogeal', 'emergent', 'submergent', 'floating',
    'attached', 'free', 'drifting', 'sessile', 'motile', 'flagellate',
    'ciliate', 'amoeboid', 'plasmodial', 'acellular', 'multinucleate',
    'coenocytic', 'septate', 'aseptate', 'branched', 'unbranched',
    'dichotomous', 'sympodial', 'monopodial', 'determinate',
    'indeterminate', 'apical', 'basal', 'intercalary', 'lateral',
    'axillary', 'terminal', 'cauline', 'foliaceous', 'petiolate',
    'sessile', 'perfoliate', 'amplexicaul', 'clasping', 'sheathing',
    'decurrent', 'auriculate', 'sagittate', 'hastate', 'peltate',
    'reniform', 'cordate', 'ovate', 'lanceolate', 'linear',
    'oblanceolate', 'obovate', 'oblong', 'elliptic', 'orbicular',
    'round', 'circular', 'spherical', 'globose', 'ovoid', 'pyriform',
    'turbinated', 'conical', 'cylindrical', 'prismatic', 'cubic',
    'tetrahedral', 'octahedral', 'dodecahedral', 'icosahedral',
    'polyhedral', 'irregular', 'amorphous', 'crystalline',
    'granular', 'powdery', 'flaky', 'fibrous', 'fasciculated',
    'fascicled', 'caespitose', 'tufted', 'clustered', 'grouped',
    'solitary', 'scattered', 'dispersed', 'aggregated', 'congregated',
    'concentrated', 'dense', 'compact', 'loose', 'sparse', 'rare',
    'common', 'abundant', 'plentiful', 'copious', 'profuse',
    'luxuriant', 'vigorous', 'robust', 'sturdy', 'strong', 'stout',
    'thick', 'thin', 'slender', 'delicate', 'fragile', 'brittle',
    'tough', 'hard', 'soft', 'firm', 'solid', 'rigid', 'stiff',
    'flexible', 'elastic', 'plastic', 'malleable', 'ductile',
    'tenacious', 'pliant', 'supple', 'limber', 'lithe', 'graceful',
    'agile', 'nimble', 'quick', 'fast', 'rapid', 'swift', 'speedy',
    'slow', 'sluggish', 'lethargic', 'torpid', 'dormant', 'hibernating',
    'estivating', 'diapause', 'quiescent', 'resting', 'sleeping',
    'awake', 'alert', 'vigilant', 'watchful', 'observant', 'attentive',
    'mindful', 'conscious', 'aware', 'cognizant', 'perceptive',
    'sensitive', 'responsive', 'reactive', 'irritable', 'excitable',
    'nervous', 'anxious', 'worried', 'concerned', 'troubled',
    'disturbed', 'upset', 'agitated', 'restless', 'fidgety',
    'impatient', 'eager', 'keen', 'enthusiastic', 'zealous',
    'ardent', 'fervent', 'passionate', 'intense', 'fierce', 'wild',
    'savage', 'ferocious', 'brutal', 'cruel', 'harsh', 'severe',
    'strict', 'stern', 'rigid', 'inflexible', 'unyielding', 'stubborn',
    'obstinate', 'headstrong', 'willful', 'wayward', 'perverse',
    'contrary', 'opposite', 'reverse', 'inverse', 'antithetical',
    'antagonistic', 'hostile', 'adversarial', 'competitive',
    'rival', 'opposing', 'conflicting', 'clashing', 'at odds',
    'disagreeing', 'disputing', 'arguing', 'debating', 'discussing',
    'conversing', 'talking', 'speaking', 'uttering', 'voicing',
    'expressing', 'articulating', 'enunciating', 'pronouncing',
    'saying', 'telling', 'informing', 'notifying', 'announcing',
    'declaring', 'proclaiming', 'asserting', 'stating', 'affirming',
    'confirming', 'verifying', 'validating', 'authenticating',
    'certifying', 'attesting', 'witnessing', 'observing', 'seeing',
    'viewing', 'looking', 'gazing', 'staring', 'glaring', 'peering',
    'squinting', 'winking', 'blinking', 'fluttering', 'waving',
    'signaling', 'gesturing', 'motioning', 'beckoning', 'summoning',
    'calling', 'shouting', 'yelling', 'screaming', 'shrieking',
    'howling', 'roaring', 'growling', 'snarling', 'hissing',
    'spitting', 'sputtering', 'spluttering', 'coughing', 'sneezing',
    'sniffing', 'snorting', 'grunting', 'groaning', 'moaning',
    'sighing', 'panting', 'breathing', 'inhaling', 'exhaling',
    'gasping', 'choking', 'gagging', 'retching', 'vomiting',
    'nauseated', 'sick', 'ill', 'unwell', 'unhealthy', 'diseased',
    'infected', 'contaminated', 'polluted', 'tainted', 'spoiled',
    'rotten', 'decayed', 'decomposed', 'putrid', 'foul', 'stinking',
    'smelly', 'odoriferous', 'fragrant', 'aromatic', 'perfumed',
    'scented', 'spiced', 'seasoned', 'flavored', 'tasted',
    'savory', 'sweet', 'sour', 'bitter', 'salty', 'umami',
    'tangy', 'tart', 'acidic', 'alkaline', 'neutral', 'balanced',
    'harmonious', 'melodious', 'tuneful', 'musical', 'rhythmic',
    'beat', 'tempo', 'meter', 'time', 'pulse', 'cadence', 'groove',
    'swing', 'shuffle', 'rock', 'roll', 'bounce', 'sway', 'nod',
    'dip', 'bob', 'duck', 'dodge', 'weave', 'swerve', 'swerve',
    'zigzag', 'meander', 'wander', 'roam', 'ramble', 'stroll',
    'saunter', 'amble', 'pace', 'stride', 'step', 'walk', 'march',
    'trudge', 'plod', 'tramp', 'trek', 'hike', 'climb', 'scale',
    'ascend', 'mount', 'rise', 'soar', 'fly', 'hover', 'float',
    'drift', 'glide', 'sail', 'navigate', 'steer', 'pilot',
    'drive', 'ride', 'saddle', 'mount', 'horseback', 'equestrian',
    'jockey', 'rider', 'riderless', 'wild', 'untamed', 'feral',
    'domestic', 'tame', 'trained', 'broken', 'gentled', 'handled',
    'managed', 'controlled', 'directed', 'guided', 'led', 'steered',
    'piloted', 'navigated', 'charted', 'mapped', 'plotted',
    'traced', 'tracked', 'followed', 'pursued', 'chased', 'hunted',
    'stalker', 'predator', 'prey', 'quarry', 'game', 'sport',
    'pastime', 'hobby', 'recreation', 'leisure', 'relaxation',
    'rest', 'repose', 'slumber', 'sleep', 'dream', 'vision',
    'fantasy', 'illusion', 'hallucination', 'delusion', 'mirage',
    'chimera', 'phantom', 'ghost', 'specter', 'apparition',
    'spirit', 'soul', 'essence', 'being', 'entity', 'creature',
    'organism', 'life', 'existence', 'reality', 'truth', 'fact',
    'fiction', 'fable', 'tale', 'story', 'narrative', 'account',
    'report', 'record', 'register', 'log', 'journal', 'diary',
    'calendar', 'schedule', 'timetable', 'agenda', 'program',
    'plan', 'scheme', 'design', 'blueprint', 'map', 'chart',
    'graph', 'diagram', 'drawing', 'sketch', 'outline', 'draft',
    'version', 'edition', 'printing', 'publication', 'issue',
    'release', 'launch', 'debut', 'premiere', 'opening', 'start',
    'beginning', 'origin', 'source', 'root', 'cause', 'reason',
    'motive', 'purpose', 'goal', 'aim', 'objective', 'target',
    'mark', 'spot', 'place', 'location', 'site', 'position',
    'point', 'dot', 'speck', 'grain', 'particle', 'molecule',
    'atom', 'electron', 'proton', 'neutron', 'quark', 'lepton',
    'boson', 'fermion', 'hadron', 'baryon', 'meson', 'photon',
    'gluon', 'graviton', 'neutrino', 'muon', 'tau', 'pion',
    'kaon', 'lambda', 'sigma', 'xi', 'omega', 'delta', 'gamma',
    'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda',
    'mu', 'nu', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon',
    'phi', 'chi', 'psi', 'omega', 'alpha', 'beta',
}

# 纯数字
PURE_DIGIT_RE = re.compile(r'^\d+$')

# 玩家名匹配（严格：纯中文+丨分隔符，不超过10字符）
CHINESE_NAME_RE = re.compile(r'^[\u4e00-\u9fa5][\u4e00-\u9fa5\uff5c\u4e28]{0,9}$')

# 战报ID
BATTLE_ID_RE = re.compile(r'^\d{7,10}_\d{10,13}(?:_\d+)?$')

# 协同ID
CO_ID_RE = re.compile(r'^co_\d{13,}$')

# 战斗事件文本特征（带 < 的富文本）
BATTLE_EVENT_TEXT_RE = re.compile(r'^<color=team\d+Color>')

# 攻方/守方团队颜色
TEAM_COLOR_ATTACK_RE = re.compile(r'team160385039025Color')
TEAM_COLOR_DEFEND_RE = re.compile(r'team172576913057Color')

# 武将名提取
HERO_NAME_RE = re.compile(r'\[([^\]]+)\]')

# 胜负结果
RESULT_ATTACK_WIN_RE = re.compile(r'攻方胜利')
RESULT_ATTACK_LOSE_RE = re.compile(r'攻方失败|攻方战平')

# 攻守分割关键词
KEYWORD_SET = {
    'might', 'skill', 'effect', 'intelligence', 'defence', 'speed',
    'strength', 'agility', 'constitution', 'wisdom', 'charisma',
    'attack', 'defense', 'magic', 'resistance', 'morale', 'fatigue',
    'damage', 'heal', 'critical', 'dodge', 'block', 'penetration',
    'buff', 'debuff', 'stun', 'silence', 'disarm', 'taunt', 'fear',
    'charm', 'confuse', 'slow', 'blind', 'poison', 'bleed', 'burn',
    'freeze', 'paralyze', 'sleep', 'regenerate', 'revive', 'summon',
    'transform', 'evolve', 'mutate', 'adapt', 'change', 'modify',
}

# 同盟名特征
ALLIANCE_RE = re.compile(
    r'^[\u4e00-\u9fa5]{2,6}[\uff5c\u4e28丨]'  # 带丨的通常是同盟名
)

# 地名特征
LOCATION_RE = re.compile(
    r'^(神机营|神机|营帐[一二三四五六七八九十]+|关口|关隘|城池|据点|要塞|堡垒|'
    r'飞将关|横戈关|散关|逐远关|破军关|陈仓|街亭|祁山|陇西|天水|安定|'
    r'武都|阴平|汉中|巴郡|成都|建业|武昌|襄阳|新野|宛城|许昌|洛阳|长安|'
    r'汝南|江夏|长沙|零陵|桂阳|武陵|南郡|江陵|公安|柴桑|庐江|合肥|'
    r'寿春|下邳|小沛|徐州|北海|青州|平原|渤海|冀州|幽州|并州|凉州|'
    r'雍州|司州|兖州|豫州|荆州|扬州|益州|交州|空地)'
)

# 非玩家名过滤（战斗事件产物：兵种加成、阵型、回合、战法名等）
BATTLE_ARTIFACT_RE = re.compile(
    r'(兵种加成|阵型|回合|第[一二三四五六七八九十]+回合|回合开始|回合结束|'
    r'执行来自|发动战法|获得战法|效果已|已施加|已消失|已刷新|已叠加|已满层|'
    r'损失了兵力|恢复了兵力|触发|进行连击|开始行动|普通攻击|'
    r'造成伤害|受到伤害|造成治疗效果|受到治疗效果|'
    r'由于.*效果|保持[不变]|兵力为[00]|[无法再战]|攻方胜利|攻方失败|攻方战平|'
    r'消耗.*次|此次伤害减少|成功规避|倒戈|'
    r'九伐中原|南疆烈刃|星罗棋布|横扫千军|锐不可当|携民渡江|无难之志|'
    r'指点乾坤|披坚执锐|雄护南疆|轻装驰援|追袭骑卫|驱兽御象|'
    r'《\S+》|《\S+》手抄|《\S+》善本)'
)


# ===== 辅助函数 =====

def is_noise(value: str) -> bool:
    if not value or len(value) < 1 or len(value) > 80:
        return True
    if CONTROL_CHAR_RE.search(value):
        return True
    if value in SKIP_WORDS:
        return True
    if PURE_DIGIT_RE.match(value):
        return True
    return False


def is_player_name(value: str) -> bool:
    if not CHINESE_NAME_RE.match(value):
        return False
    if BATTLE_ARTIFACT_RE.search(value):
        return False
    return True


def is_alliance(value: str) -> bool:
    if not CHINESE_NAME_RE.match(value):
        return False
    return ALLIANCE_RE.match(value) is not None


def is_location(value: str) -> bool:
    return LOCATION_RE.match(value) is not None


def extract_heroes_from_entries(entries: list[dict]):
    attack_heroes = []
    defend_heroes = []
    result = '交战'
    
    attack_seen = set()
    defend_seen = set()
    
    for e in entries:
        v = e.get('v', '')
        
        if RESULT_ATTACK_WIN_RE.search(v):
            result = '胜利'
        elif RESULT_ATTACK_LOSE_RE.search(v):
            result = '失败'
        
        if not BATTLE_EVENT_TEXT_RE.search(v):
            continue
        
        m = HERO_NAME_RE.search(v)
        if not m:
            continue
        
        hero_name = m.group(1)
        
        if not re.match(r'^[\u4e00-\u9fa5]+$', hero_name):
            continue
        
        if TEAM_COLOR_ATTACK_RE.search(v):
            if hero_name not in attack_seen:
                attack_heroes.append(hero_name)
                attack_seen.add(hero_name)
        elif TEAM_COLOR_DEFEND_RE.search(v):
            if hero_name not in defend_seen:
                defend_heroes.append(hero_name)
                defend_seen.add(hero_name)
    
    return attack_heroes, defend_heroes, result


# ===== 主解析函数 =====

def parse_entries(entries: list[dict], structured: dict = None) -> list[dict]:
    structured = structured or {}
    
    # Extract global heroes/result from ALL entries (battle text is at different timestamps)
    global_a_heroes, global_d_heroes, global_result = extract_heroes_from_entries(entries)
    
    # Build timestamp-indexed entries for lookup (deduplicated by t+v+k)
    entries_by_t = {}
    seen_entries = set()
    for e in entries:
        t = e.get('t', 0)
        key = (t, e.get('v', ''), e.get('k', ''))
        if key in seen_entries:
            continue
        seen_entries.add(key)
        if t not in entries_by_t:
            entries_by_t[t] = []
        entries_by_t[t].append(e)
    
    # Cluster timestamps based on non-noise values
    cluster_ts_list = []
    current_ts = []
    last_t = 0
    
    for e in entries:
        t = e.get('t', 0)
        v = e.get('v', '')
        if is_noise(v):
            continue
        if t - last_t > 100 and current_ts:
            cluster_ts_list.append(current_ts)
            current_ts = []
        if t not in current_ts:
            current_ts.append(t)
        last_t = t
    if current_ts:
        cluster_ts_list.append(current_ts)
    
    records = []
    seen_keys = set()
    
    for cluster_ts in cluster_ts_list:
        # Use global heroes/result (battle text timestamps don't align with player name timestamps)
        a_lineup = global_a_heroes
        d_lineup = global_d_heroes
        result = global_result
        
        # Get non-noise values for this cluster (deduplicated)
        values = []
        seen_vals = set()
        for t in cluster_ts:
            if t in entries_by_t:
                for e in entries_by_t[t]:
                    v = e.get('v', '')
                    if not is_noise(v) and v not in seen_vals:
                        values.append(v)
                        seen_vals.add(v)
        
        if not values:
            continue
        
        names = [v for v in values if is_player_name(v)]
        battle_ids = [v for v in values if BATTLE_ID_RE.match(v)]
        co_ids = [v for v in values if CO_ID_RE.match(v)]
        
        if not names and not battle_ids and not co_ids:
            continue
        
        ki = []
        for i, v in enumerate(values):
            if v in KEYWORD_SET:
                ki.append(i)
        
        if ki:
            k_s, k_e = ki[0], ki[-1] + 1
            pre_vals = values[:k_s]
            post_vals = values[k_e:]
        else:
            alliances = [v for v in values if is_alliance(v)]
            if len(alliances) >= 2:
                split_idx = 0
                found_first = False
                for i, v in enumerate(values):
                    if is_alliance(v):
                        if found_first:
                            split_idx = i
                            break
                        found_first = True
                if split_idx > 0:
                    pre_vals = values[:split_idx]
                    post_vals = values[split_idx:]
                else:
                    mid = max(len(names) // 2, 1)
                    pre_vals = values[:mid]
                    post_vals = values[mid:]
            else:
                mid = max(len(names) // 2, 1)
                name_count = 0
                split_idx = 0
                for i, v in enumerate(values):
                    if CHINESE_NAME_RE.match(v):
                        name_count += 1
                        if name_count == mid:
                            split_idx = i + 1
                            break
                if split_idx > 0:
                    pre_vals = values[:split_idx]
                    post_vals = values[split_idx:]
                else:
                    pre_vals = values
                    post_vals = []
        
        a_alliance = ""
        a_players = []
        for n in pre_vals:
            if not CHINESE_NAME_RE.match(n):
                continue
            if is_alliance(n):
                a_alliance = n
            elif is_location(n):
                pass
            else:
                a_players.append(n)
        
        d_alliance = ""
        d_players = []
        for n in post_vals:
            if not CHINESE_NAME_RE.match(n):
                continue
            if is_alliance(n):
                d_alliance = n
            elif is_location(n):
                pass
            else:
                d_players.append(n)
        
        a_player = a_players[0] if a_players else ""
        d_player = d_players[0] if d_players else ""
        d_other_players = d_players[1:] if len(d_players) > 1 else []
        
        record = {
            'attack_alliance': a_alliance,
            'attack_player': a_player,
            'defend_alliance': d_alliance,
            'defend_player': d_player,
            'defend_other_players': d_other_players,
            'result': result,
            'attack_lineup': '、'.join(a_lineup) if a_lineup else '',
            'defend_lineup': '、'.join(d_lineup) if d_lineup else '',
            'battle_ids': battle_ids,
            'co_ids': co_ids,
            'raw': values,
        }
        
        key = f"{a_alliance}_{a_player}_{d_alliance}_{d_player}"
        if not a_player and not d_player and not battle_ids:
            continue
        if key in seen_keys:
            continue
        seen_keys.add(key)
        records.append(record)
    
    return records


# ===== 输出格式化 =====

def format_battle_line(rec: dict) -> str:
    a_alliance = f"{rec['attack_alliance']}的" if rec['attack_alliance'] else ""
    a_player = rec['attack_player'] or "未知玩家"
    a_lineup = rec.get('attack_lineup', '')

    d_alliance = f"{rec['defend_alliance']}的" if rec['defend_alliance'] else ""
    d_player = rec['defend_player'] or "未知玩家"
    d_lineup = rec.get('defend_lineup', '')
    d_others = rec.get('defend_other_players', [])
    d_display = d_player
    if d_others:
        d_display = f"{d_player}、{'、'.join(d_others)}"

    result = rec.get('result', '交战')

    lineup_str = ''
    if a_lineup:
        lineup_str = f"使用{a_lineup}阵容"
    if d_lineup:
        lineup_str += f"对阵{d_lineup}阵容"

    if lineup_str:
        return f"{a_alliance}{a_player} {lineup_str} {result}"
    return f"{a_alliance}{a_player} {result} {d_alliance}{d_display}"


def generate_report(records: list[dict], structured: bool = False) -> str:
    lines = []
    lines.append("=" * 60)
    lines.append(f"  同盟战报列表 (共 {len(records)} 条)")
    lines.append("=" * 60)
    lines.append("")
    for i, rec in enumerate(records, 1):
        lines.append(f"  [{i}] {format_battle_line(rec)}")
        if rec.get('battle_ids'):
            ids = ', '.join(rec['battle_ids'][:3])
            lines.append(f"      战报ID: {ids}")
        lines.append("")
    return "\n".join(lines)


def save_alliance_report(records: list[dict], output_dir: str, timestamp: str = None):
    os.makedirs(output_dir, exist_ok=True)
    stamp = timestamp or timestamp_for_file()
    prefix = f"alliance_battles_{stamp}"
    report = generate_report(records)
    
    # txt
    txt_path = os.path.join(output_dir, f"{prefix}.txt")
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write(report)
    with open(os.path.join(output_dir, "alliance_battles.latest.txt"), 'w', encoding='utf-8') as f:
        f.write(report)
    
    # json
    json_path = os.path.join(output_dir, f"{prefix}.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    with open(os.path.join(output_dir, "alliance_battles.latest.json"), 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    
    # csv
    csv_path = os.path.join(output_dir, f"{prefix}.csv")

    def write_csv(path):
        with open(path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            w.writerow(['序号', '攻方同盟', '攻方玩家', '攻方阵容', '结果', '守方同盟', '守方玩家', '守方阵容', '守方其他玩家', '战报ID'])
            for i, rec in enumerate(records, 1):
                w.writerow([
                    i,
                    rec.get('attack_alliance', ''),
                    rec.get('attack_player', ''),
                    rec.get('attack_lineup', ''),
                    rec.get('result', ''),
                    rec.get('defend_alliance', ''),
                    rec.get('defend_player', ''),
                    rec.get('defend_lineup', ''),
                    '、'.join(rec.get('defend_other_players', [])),
                    '、'.join(rec.get('battle_ids', [])[:3]),
                ])

    write_csv(csv_path)
    write_csv(os.path.join(output_dir, "alliance_battles.latest.csv"))


def parse_jsonl(jsonl_path: str) -> list[dict]:
    records = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


# ===== 主函数 =====

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(script_dir, "output")
    jsonl_path = os.path.join(output_dir, "alliance_raw.jsonl")
    
    if os.path.exists(jsonl_path):
        entries = parse_jsonl(jsonl_path)
        records = parse_entries(entries)
        save_alliance_report(records, output_dir)
        print(f"Parsed {len(records)} records from jsonl")
    else:
        print(f"File not found: {jsonl_path}")

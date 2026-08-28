// ---------- DEFAULT DATA ----------
const CITY_ALIASES = {
  "helsinki": ["helsingissä","helsinkiin","helsingin","helsingistä"],
  "espoo": ["espoossa","espooseen","espoon","espoosta"],
  "tampere": ["tampereella","tampereelle","tampereen","tampereelta"],
  "vantaa": ["vantaalla","vantaalle","vantaan","vantaalta"],
  "oulu": ["oulussa","ouluun","oulun","oulusta"],
  "turku": ["turussa","turkuun","turun","turusta"],
  "jyväskylä": ["jyväskylässä","jyväskylään","jyväskylän","jyväskylästä"],
  "lahti": ["lahdessa","lahteen","lahden","lahdesta"],
  "kuopio": ["kuopiossa","kuopioon","kuopion","kuopiosta"],
  "kouvola": ["kouvolassa","kouvolaan","kouvolan","kouvolasta"],
  "pori": ["porissa","poriin","porin","porista"],
  "joensuu": ["joensuussa","joensuuhun","joensuun","joensuusta"],
  "lappeenranta": ["lappeenrannassa","lappeenrantaan","lappeenrannan","lappeenrannasta"],
  "hämeenlinna": ["hämeenlinnassa","hämeenlinnaan","hämeenlinnan","hämeenlinnasta"],
  "vaasa": ["vaasassa","vaasaan","vaasan","vaasasta"],
  "seinäjoki": ["seinäjoella","seinäjoelle","seinäjoen","seinäjoelta"],
  "rovaniemi": ["rovaniemellä","rovaniemelle","rovaniemen","rovaniemeltä"],
  "mikkeli": ["mikkelissä","mikkeliin","mikkelin","mikkelistä"],
  "kotka": ["kotkassa","kotkaan","kotkan","kotkasta"],
  "salo": ["salossa","saloon","salon","salosta"]
};
const CITY_LIST = [
  "helsinki","espoo","tampere","vantaa","oulu","turku","jyväskylä","lahti","kuopio","kouvola",
  "pori","joensuu","lappeenranta","hämeenlinna","vaasa","seinäjoki","rovaniemi","mikkeli","kotka","salo",
  "porvoo","kokkola","hyvinkää","lohja","järvenpää","rauma","kajaani","imatra","riihimäki","nokia",
  "kerava","savonlinna","varkaus","raahe","kaskinen","kristiinankaupunki","ylivieska","iisalmi","valkeakoski",
  "kauhava","kauhajoki","loviisa","naantali","uusikaupunki","heinola","pieksämäki","forssa","äänekoski",
  "kuusamo","tornio","kemi","kemijärvi","loimaa","somero","parainen","hamina","orimattila","pietarsaari",
  "uusikaarlepyy","ikaalinen","virrat","parkano","sastamala","akaa","kangasala","raisio","kaarina",
  "kirkkonummi","tuusula","nurmijärvi","vihti","mänttä"
];

function defaultCategories(){
  return [
    {
      name: "Suomen kaupungit",
      answers: CITY_LIST.map(c => ({
        canonical: c,
        forms: CITY_ALIASES[c] || []
      }))
    },
    {
      name: "Esimerkki: Pohjoismaat (täytä admin-paneelissa)",
      answers: [
        { canonical: "suomi", forms: ["suomessa","suomeen","suomen"] },
        { canonical: "ruotsi", forms: ["ruotsissa","ruotsiin","ruotsin"] },
        { canonical: "norja", forms: ["norjassa","norjaan","norjan"] },
        { canonical: "tanska", forms: ["tanskassa","tanskaan","tanskan"] },
        { canonical: "islanti", forms: ["islannissa","islantiin","islannin"] }
      ]
    }
  ];
}

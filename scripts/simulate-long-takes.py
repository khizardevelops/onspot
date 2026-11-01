# SPDX-License-Identifier: AGPL-3.0-or-later
"""Builds two simulated long takes (3 and 5 minutes of spoken French) with planted mistakes, for
src/lib/dev/longTakes.json (the /dev/long-takes/ page adds them to the app, to test long cards).

Each sentence marks a mistake as {wrong|right}: the transcript uses the wrong form, the correct
version the right one, and the correction list is built from the same marks, so the three agree.
"""
import json
import re

MARK = re.compile(r"\{([^|}]*)\|([^}]*)\}")

# Correction details per wrong form: category, severity, label, explanation, meaning of the fix.
CORRECTIONS = {
    "Alors, euh,": ("filler", "warning", "Filler before the first point", "A hesitation that adds nothing; start straight with « Alors ».", "So,"),
    "j'ai allé": ("grammar", "error", "Wrong auxiliary with aller", "« Aller » forms its passé composé with « être »: je suis allé.", "I went"),
    "beaucoup des": ("grammar", "error", "« beaucoup de » before a noun", "After « beaucoup », use « de », not « des ».", "many"),
    "que j'ai jamais mangé": ("grammar", "error", "Subjunctive after a superlative", "After « le meilleur… que », French uses the subjunctive: que j'aie jamais mangé.", "that I have ever eaten"),
    "dans Porto": ("grammar", "error", "Preposition before a city", "With a city, use « à »: à Porto.", "to Porto"),
    "que je me souviens": ("grammar", "error", "Relative pronoun with se souvenir de", "« Se souvenir de » takes « dont »: un moment dont je me souviens.", "that I remember"),
    "J'étais vraiment excité": ("register", "warning", "Anglicism « excité »", "« Excité » suggests agitation in French; to say you looked forward to it, use « avoir hâte ».", "I was really looking forward"),
    "essayait": ("grammar", "error", "Verb agreement with « ils »", "The subject « ils » is plural: ils essayaient.", "were trying"),
    "Ouais, franchement": ("register", "warning", "Casual « ouais »", "« Ouais » is very casual; in an exam say « Franchement » or « Oui ».", "Honestly"),
    "la sud": ("grammar", "error", "Gender of « sud »", "« Sud » is masculine: le sud.", "the south"),
    "Bon, euh,": ("filler", "warning", "Filler before the first point", "Start without the hesitation: « Bon, je vais vous parler… ».", "Well,"),
    "Depuis deux ans, j'ai étudié": ("grammar", "error", "Tense with « depuis »", "An action still going on with « depuis » takes the present: Depuis deux ans, j'étudie.", "For two years I have been studying"),
    "l'utilise": ("grammar", "error", "Verb agreement with « beaucoup de mes amis »", "« Beaucoup de mes amis » is plural: l'utilisent.", "use it"),
    "des mauvaises notes": ("style", "suggestion", "« de » before an adjective + noun", "Before an adjective placed before the noun, careful French uses « de »: de mauvaises notes.", "bad marks"),
    "Je réalise maintenant que": ("register", "warning", "Anglicism « réaliser »", "« Réaliser » means to carry out; to say you understand, use « se rendre compte ».", "I now realise that"),
    "il faut que j'ai": ("grammar", "error", "Subjunctive after « il faut que »", "« Il faut que » takes the subjunctive: que j'aie.", "I need to have"),
    "personne m'a répondu": ("register", "warning", "Dropped « ne » in the negation", "Speech often drops « ne », but an exam expects it: personne ne m'a répondu.", "nobody has answered me"),
    "J'ai entendu que": ("grammar", "error", "« entendre dire que »", "To report something you heard, French says « J'ai entendu dire que ».", "I have heard that"),
    "Si j'aurais": ("grammar", "error", "Conditional after « si »", "After « si », use the imperfect, not the conditional: Si j'avais.", "If I had"),
    "Ouais, genre,": ("register", "warning", "Casual « ouais, genre »", "« Ouais, genre » is very casual filler; say « Franchement » or nothing.", "Honestly,"),
    "devenir un médecin": ("grammar", "error", "No article before a profession", "After « devenir », a profession takes no article: devenir médecin.", "become a doctor"),
    "Voilà, euh,": ("filler", "warning", "Filler before the conclusion", "End cleanly: « Voilà, c'est à peu près tout… ».", "So,"),
}

SCENARIO_A = [  # « Parlez d'un voyage qui vous a marqué. » — about 3 minutes
    "{Alors, euh,|Alors,} je vais vous parler d'un voyage qui m'a vraiment marqué.",
    "L'année dernière, {j'ai allé|je suis allé} au Portugal avec ma famille pendant deux semaines.",
    "On est partis au mois de juillet, juste après la fin des examens.",
    "Le premier jour, nous sommes arrivés à Lisbonne très tard dans la nuit, et tout le monde était fatigué.",
    "L'hôtel était petit mais très charmant, avec une terrasse qui donnait sur toute la ville.",
    "Le matin, on prenait le petit-déjeuner dehors et on regardait les bateaux sur le fleuve.",
    "Ce qui m'a frappé, c'est la lumière : elle est différente de chez nous, plus douce et plus dorée.",
    "Nous avons visité {beaucoup des|beaucoup de} monuments, comme la tour de Belém et le monastère des Hiéronymites.",
    "Mon frère voulait tout photographier, donc on avançait très lentement.",
    "Un jour, on a pris le tram vingt-huit, qui traverse les vieux quartiers de la ville.",
    "Il était plein de touristes, et il faisait très chaud dedans.",
    "Après, on a mangé des pastéis de nata dans une petite pâtisserie, et c'était le meilleur dessert {que j'ai jamais mangé|que j'aie jamais mangé}.",
    "La deuxième semaine, on est allés {dans Porto|à Porto}, dans le nord du pays.",
    "Le voyage en train a duré presque trois heures, mais le paysage était magnifique.",
    "À Porto, nous sommes restés dans un appartement tout près de la rivière.",
    "Le soir, on se promenait sur les quais et on écoutait des musiciens qui jouaient du fado.",
    "Je ne comprenais pas les paroles, mais la musique était très émouvante.",
    "Ma mère a même pleuré une fois, ce qui nous a beaucoup surpris.",
    "On a aussi visité des caves où on fabrique le vin de Porto.",
    "Le guide nous a expliqué comment le vin vieillit dans de grands tonneaux en bois.",
    "Moi, j'ai seulement goûté un jus de raisin, parce que je ne bois pas d'alcool.",
    "Un autre moment {que je me souviens|dont je me souviens}, c'est une journée entière à la plage.",
    "L'eau de l'Atlantique était glaciale, mais on s'est baignés quand même.",
    "{J'étais vraiment excité|J'avais vraiment hâte} de voir les grandes vagues, parce que j'adore le surf.",
    "Malheureusement, je n'ai pas pu surfer, parce que le vent était trop fort ce jour-là.",
    "Ce voyage m'a appris beaucoup de choses sur la culture portugaise.",
    "Les gens étaient très gentils, et ils {essayait|essayaient} toujours de nous aider, même quand on ne parlait pas leur langue.",
    "J'ai appris quelques mots, comme obrigado, qui veut dire merci.",
    "{Ouais, franchement|Franchement}, c'était le plus beau voyage de ma vie.",
    "Je voudrais y retourner un jour, peut-être avec mes amis, pour découvrir {la sud|le sud} du pays et l'Algarve.",
    "Voilà, c'est tout ce que je voulais raconter sur ce voyage.",
]

SCENARIO_B = [  # « Parlez de votre projet professionnel. » — about 5 minutes
    "{Bon, euh,|Bon,} je vais vous parler de mon projet professionnel et du travail que je voudrais faire plus tard.",
    "Depuis que je suis petit, je suis passionné par la technologie et par les ordinateurs.",
    "Quand j'avais dix ans, mon père m'a offert un vieil ordinateur portable, et j'ai passé des heures à le démonter pour comprendre comment il fonctionnait.",
    "À l'époque, je ne savais pas que ça pouvait devenir un vrai métier.",
    "Aujourd'hui, j'étudie l'informatique à l'université, et je suis en deuxième année de licence.",
    "{Depuis deux ans, j'ai étudié|Depuis deux ans, j'étudie} le développement web et les bases de données.",
    "Ce que j'aime le plus, c'est créer des applications qui sont vraiment utiles pour les gens.",
    "Par exemple, l'année dernière, j'ai développé une petite application pour aider les étudiants à organiser leurs révisions.",
    "Beaucoup de mes amis {l'utilise|l'utilisent} encore aujourd'hui, et ça me rend très fier.",
    "Mon travail idéal, ce serait dans une entreprise qui travaille sur l'éducation.",
    "Je pense que la technologie peut vraiment changer la façon dont on apprend.",
    "Par exemple, il y a des applications qui permettent d'apprendre une langue en parlant un peu tous les jours.",
    "C'est un domaine qui m'intéresse énormément, parce que j'ai moi-même eu des difficultés à l'école.",
    "Quand j'étais au collège, j'avais {des mauvaises notes|de mauvaises notes} en anglais, parce que je n'osais pas parler.",
    "Les professeurs étaient gentils, mais il y avait trente élèves dans la classe.",
    "On n'avait pas le temps de pratiquer l'oral, donc on apprenait surtout la grammaire.",
    "{Je réalise maintenant que|Je me rends compte maintenant que} c'était une erreur, parce qu'une langue, ça se parle avant tout.",
    "C'est pour ça que je voudrais créer des outils qui donnent plus de place à la parole.",
    "Pour y arriver, je sais que je dois encore beaucoup travailler.",
    "D'abord, je veux finir ma licence et ensuite faire un master en intelligence artificielle.",
    "Le problème, c'est que les masters sont très sélectifs, et {il faut que j'ai|il faut que j'aie} de très bonnes notes.",
    "Donc cette année, je fais beaucoup d'efforts, surtout en mathématiques.",
    "Je travaille aussi le soir sur des projets personnels, pour avoir un portfolio à montrer.",
    "La semaine dernière, je suis resté jusqu'à trois heures du matin pour finir un programme.",
    "C'était fatigant, mais le résultat en valait vraiment la peine.",
    "En plus des études, je voudrais faire un stage dans une start-up.",
    "J'ai déjà envoyé mon CV à plusieurs entreprises, mais {personne m'a répondu|personne ne m'a répondu} pour l'instant.",
    "Mon professeur m'a conseillé de participer à des hackathons pour rencontrer des professionnels.",
    "Le mois prochain, je vais participer à mon premier hackathon, à Lyon.",
    "Je suis un peu stressé, parce que je ne connais personne là-bas.",
    "Mais je pense que c'est une bonne occasion d'apprendre et de me faire des contacts.",
    "Plus tard, j'aimerais aussi travailler à l'étranger pendant quelques années.",
    "Je rêve d'aller au Canada, parce qu'on peut y travailler en français et en anglais.",
    "{J'ai entendu que|J'ai entendu dire que} les entreprises de technologie à Montréal cherchent beaucoup de développeurs.",
    "En plus, la nature là-bas est incroyable, avec les lacs et les forêts.",
    "J'ai vu des photos de l'hiver, et ça a l'air magnifique, même s'il fait très froid.",
    "Mes parents sont un peu inquiets, parce que ce serait loin de la famille.",
    "Ma mère dit toujours qu'elle ne pourrait pas vivre sans voir ses enfants chaque semaine.",
    "Mais je pense qu'avec internet, c'est plus facile de rester en contact qu'avant.",
    "On peut se parler en vidéo tous les jours si on veut.",
    "{Si j'aurais|Si j'avais} assez d'argent, je les inviterais à venir me voir chaque été.",
    "{Ouais, genre,|Franchement,} ce serait génial de leur montrer ma nouvelle vie.",
    "Bien sûr, je ne sais pas encore si tout ça va se réaliser.",
    "Les projets changent souvent, et la vie nous réserve parfois des surprises.",
    "Il y a cinq ans, je voulais {devenir un médecin|devenir médecin}, et maintenant je fais de l'informatique.",
    "Mais je crois que l'important, c'est de faire quelque chose qu'on aime et qui a du sens.",
    "Pour moi, aider les gens à apprendre, ça a vraiment du sens.",
    "Je suis sûr que si je travaille dans ce domaine, je serai heureux.",
    "{Voilà, euh,|Voilà,} c'est à peu près tout ce que je voulais dire sur mon projet professionnel.",
    "Merci de m'avoir écouté.",
]


def build(sentences, title, prompt, duration_sec, explanation, follow_up):
    transcript = " ".join(MARK.sub(lambda m: m.group(1), s) for s in sentences)
    corrected = " ".join(MARK.sub(lambda m: m.group(2), s) for s in sentences)
    corrections = []
    for sentence in sentences:
        for wrong, right in MARK.findall(sentence):
            category, severity, label, why, meaning = CORRECTIONS[wrong]
            assert wrong in transcript, wrong
            corrections.append({
                "category": category, "severity": severity, "label": label,
                "original": wrong, "replacement": right, "replacementTranslation": meaning,
                "explanation": why, "examStatus": "avoid" if category in ("register", "filler") else None,
            })
    words = len(re.findall(r"[\w’']+(?:[-’'][\w]+)*", transcript))
    with_mistakes = sum(1 for s in sentences if MARK.search(s))
    return {
        "title": title, "prompt": prompt, "durationSec": duration_sec,
        "transcript": transcript, "correctedText": corrected, "wordCount": words,
        "explanation": explanation, "followUp": follow_up, "corrections": corrections,
        "stats": {"sentences": len(sentences), "sentencesWithMistakes": with_mistakes, "mistakes": len(corrections), "words": words, "wordsPerMinute": round(words / (duration_sec / 60))},
    }


takes = [
    build(SCENARIO_A, "Un voyage marquant", "Parlez d'un voyage qui vous a marqué.", 180,
          "What a vivid trip, I could see the light over Lisbon! You said <wrong>j'ai allé</wrong>, but <key>aller</key> takes <key>être</key>: <right>je suis allé</right>. With a city, say <right>à Porto</right>, not <wrong>dans Porto</wrong>. And after <key>beaucoup</key> it's just <key>de</key>: <right>beaucoup de</right> monuments.",
          {"question": "Qu'est-ce que vous aimeriez découvrir dans le sud du Portugal ?", "translation": "What would you like to discover in the south of Portugal?"}),
    build(SCENARIO_B, "Mon projet professionnel", "Parlez de votre projet professionnel.", 300,
          "You explained your plans really clearly, and the story about your app was great. You said <wrong>Si j'aurais</wrong>; after <key>si</key> use the imperfect: <right>Si j'avais</right>. It's <right>il faut que j'aie</right>, with the subjunctive after <key>il faut que</key>. And with a profession, drop the article: <right>devenir médecin</right>.",
          {"question": "Qu'est-ce qui vous attire le plus dans le travail à Montréal ?", "translation": "What attracts you most about working in Montréal?"}),
]
for take in takes:
    print(take["title"], take["stats"])
OUT = __import__("pathlib").Path(__file__).resolve().parent.parent / "src/lib/dev/longTakes.json"
json.dump(takes, open(OUT, "w"), ensure_ascii=False, indent=1)
print("wrote", OUT)

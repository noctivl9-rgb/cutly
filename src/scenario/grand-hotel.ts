// DOSSIER 001 — LE MYSTÈRE DU GRAND HÔTEL
// Scénario de démonstration complet. Toutes les informations nécessaires à la résolution sont
// accessibles en jeu (lieux, indices, enveloppes, témoignages). Les personnages mentent
// volontairement ; leurs mensonges sont listés dans `truth.lies` et contredits par des preuves.
import type { ScenarioDefinition } from './types.ts';

const STAGE1_ITEMS = ['IDX-001', 'IDX-003', 'IDX-004', 'IDX-005', 'IDX-009', 'IDX-010', 'IDX-013', 'IDX-014', 'IDX-017', 'TEM-LUCAS', 'TEM-GASTON', 'IDX-021', 'IDX-022'];

export const grandHotel: ScenarioDefinition = {
  slug: 'grand-hotel',
  caseNumber: '001',
  meta: {
    title: 'Le Mystère du Grand Hôtel',
    synopsis:
      "Nuit du 14 au 15 novembre 1957, Grand Hôtel des Embruns, sur la côte normande. La tempête a coupé la route de Caen. " +
      "À 6 h 45, Hélène Valmont découvre le corps de son frère Edmond, propriétaire de l'hôtel, dans son bureau. " +
      "Le coffre-fort est ouvert. L'inspecteur Marchal ne pourra pas franchir la route inondée avant midi. " +
      "Six personnes ont passé la nuit dans l'hôtel. L'une d'elles a tué Edmond Valmont.",
    objective:
      "Avant l'arrivée de l'inspecteur Marchal, désigner le meurtrier d'Edmond Valmont, établir son mobile, reconstituer la chronologie de la nuit et présenter les preuves qui le confondent.",
    difficulty: 'intermédiaire',
    durationMinutes: 150,
    minPlayers: 3,
    maxPlayers: 6,
    intro: {
      tagline: "La tempête a isolé l'hôtel. Le meurtrier est encore parmi vous.",
      victim: {
        name: 'Edmond Valmont',
        age: 64,
        description:
          "Propriétaire du Grand Hôtel des Embruns depuis 1931. Homme de principes, réputé autoritaire mais généreux : il a créé en 1948 la Fondation Valmont, qui finance l'orphelinat de Houlgate. Victime d'un infarctus en 1955.",
      },
      accusation: {
        motives: [
          { key: 'heritage', label: "Toucher l'héritage plus tôt" },
          { key: 'dettes', label: 'Rembourser des dettes de jeu' },
          { key: 'detournement', label: 'Couvrir un détournement de fonds' },
          { key: 'liaison', label: 'Protéger une liaison secrète' },
          { key: 'filiation', label: 'Venger une filiation reniée' },
          { key: 'licenciement', label: 'Éviter un renvoi' },
        ],
      },
    },
  },
  stages: [
    { idx: 1, title: 'La scène de crime', description: "Le bureau, la réception et les salles communes peuvent être examinés.", unlock: { type: 'start' } },
    {
      idx: 2,
      title: 'Les fouilles',
      description: "Les chambres et la réserve sont désormais accessibles. La Banque de Normandie a fait parvenir un courrier.",
      unlock: { type: 'items', among: STAGE1_ITEMS, min: 7 },
    },
    {
      idx: 3,
      title: 'Les aveux',
      description: "Confrontés aux preuves, les témoins parlent. L'accusation peut être préparée.",
      unlock: { type: 'items', all: ['IDX-018', 'IDX-020'] },
    },
  ],
  locations: [
    {
      ref: 'LIEU-HALL', key: 'hall', name: 'Hall', stage: 1,
      public: {
        description: "Grand hall à colonnes, carrelage noir et blanc. Une horloge Morbier, réglée chaque matin par Hélène Valmont, domine l'escalier d'honneur qui mène aux chambres.",
        hours: 'Ouvert jour et nuit',
        characters: ['PER-HELENE', 'PER-CAMILLE'],
      },
    },
    {
      ref: 'LIEU-RECEPTION', key: 'reception', name: 'Réception', stage: 1,
      public: {
        description: "Comptoir d'acajou, tableau des clés, standard téléphonique à fiches. Une porte capitonnée donne directement sur le bureau du directeur.",
        hours: 'Tenue la nuit par Camille Roussel (22 h – 7 h)',
        characters: ['PER-CAMILLE'],
      },
    },
    {
      ref: 'LIEU-BUREAU', key: 'bureau', name: 'Bureau', stage: 1,
      public: {
        description: "Le bureau d'Edmond Valmont. Deux portes : l'une vers la réception, l'autre vers le couloir de service. Le corps a été recouvert d'un drap ; rien d'autre n'a été déplacé.",
        hours: "Scène de crime — découverte du corps à 6 h 45",
        characters: ['PER-HELENE'],
      },
    },
    {
      ref: 'LIEU-CUISINE', key: 'cuisine', name: 'Cuisine', stage: 1,
      public: {
        description: "Fourneaux encore tièdes, odeur de fond de veau. Un passe-plat ouvre sur le restaurant ; une porte mène à la réserve.",
        hours: 'Fermeture officielle à 23 h',
        characters: ['PER-VICTOR'],
      },
    },
    {
      ref: 'LIEU-RESTAURANT', key: 'restaurant', name: 'Restaurant', stage: 1,
      public: {
        description: "Salle aux lustres de cristal, bar en zinc au fond. Les chaises sont retournées sur les tables, sauf au comptoir.",
        hours: 'Bar ouvert jusqu’à 23 h 45',
        characters: ['PER-JULIEN', 'PER-VICTOR'],
      },
    },
    {
      ref: 'LIEU-SALON', key: 'salon', name: 'Salon', stage: 1,
      public: {
        description: "Salon de musique aux boiseries vertes. Le piano Pleyel est resté ouvert, une partition sur le pupitre.",
        hours: 'Récital de 21 h à 21 h 45, puis de 23 h à 23 h 45',
        characters: ['PER-MARGAUX'],
      },
    },
    {
      ref: 'LIEU-COULOIRS', key: 'couloirs', name: 'Couloirs', stage: 1,
      public: {
        description: "Le couloir de service relie la cuisine, la réserve, le bureau et l'escalier de service sans passer par la réception. Il est faiblement éclairé la nuit.",
        hours: 'Éclairage de veille après 23 h',
        characters: [],
      },
    },
    {
      ref: 'LIEU-ESCALIER', key: 'escalier', name: 'Escalier de service', stage: 1,
      public: {
        description: "Escalier étroit en colimaçon entre le couloir de service et le premier étage. Un palier intermédiaire possède une petite fenêtre donnant sur la mer.",
        hours: 'Réservé au personnel',
        characters: ['PER-CAMILLE'],
      },
    },
    {
      ref: 'LIEU-CHAMBRES', key: 'chambres', name: 'Chambres', stage: 2,
      public: {
        description: "Premier étage. La chambre 7 est occupée par Julien Valmont, la chambre 12 par Maître Delmas, la chambre 3 par Margaux Fersen. Hélène Valmont occupe l'appartement du fond.",
        hours: "Fouille autorisée à partir de l'étape 2",
        characters: ['PER-JULIEN', 'PER-ARTHUR', 'PER-MARGAUX', 'PER-HELENE'],
      },
    },
    {
      ref: 'LIEU-RESERVE', key: 'reserve', name: 'Réserve', stage: 2,
      public: {
        description: "Réserve des vins et de l'épicerie, entre la cuisine et le couloir de service. Une banquette y sert au repos du personnel.",
        hours: "Fouille autorisée à partir de l'étape 2",
        characters: ['PER-VICTOR'],
      },
    },
  ],
  characters: [
    {
      ref: 'PER-HELENE', name: 'Hélène Valmont', role: 'Directrice et copropriétaire',
      public: {
        age: 58,
        portrait: { accessory: 'chignon', tone: '#8a6f5a' },
        presentation: "Sœur cadette d'Edmond, veuve depuis la guerre. Elle dirige l'hôtel au quotidien avec une rigueur que le personnel redoute.",
        relations: ["Sœur d'Edmond", 'Tante de Julien', 'Employeuse de Victor et de Camille'],
        alibi: "« Je suis montée dans mon appartement à 22 h 45. J'ai lu jusqu'à minuit, puis je me suis couchée. »",
        declaredMovements: [{ at: '22:45', place: 'LIEU-CHAMBRES', text: 'Monte dans son appartement' }],
      },
      private: {
        biography:
          "Tu as passé ta vie à faire tourner l'hôtel pendant qu'Edmond en recevait les honneurs. Depuis deux ans, tu vis une liaison avec Victor Lanzac, le chef. Edmond l'ignorait ; il n'aurait jamais toléré qu'une Valmont fréquente un employé.",
        realMovements: [
          { at: '22:45', place: 'LIEU-CHAMBRES', text: 'Tu montes un instant dans ton appartement.' },
          { at: '23:05', place: 'LIEU-RESERVE', text: 'Tu rejoins Victor à la réserve par l’escalier d’honneur et le couloir de service.' },
          { at: '23:35', place: 'LIEU-RESERVE', text: 'Tu quittes la réserve.' },
          { at: '23:40', place: 'LIEU-CHAMBRES', text: 'Tu regagnes ton appartement par l’escalier d’honneur.' },
          { at: '06:45', place: 'LIEU-BUREAU', text: 'Tu découvres le corps d’Edmond.' },
        ],
        secrets: [
          'Tu étais à la réserve avec Victor de 23 h 05 à 23 h 35 : vous êtes l’alibi l’un de l’autre.',
          "Edmond avait cessé de fumer après son infarctus de 1955. Il ne supportait plus la moindre fumée : il ouvrait la fenêtre dès qu'un client allumait un cigare.",
        ],
        motivations: "Préserver l'hôtel et ta réputation. Tu crains que ta liaison ne fasse de toi une suspecte.",
        objectives: [
          'Cacher ta liaison avec Victor le plus longtemps possible.',
          "Faire comprendre aux autres qu'Edmond ne fumait jamais.",
          "Découvrir qui a tué ton frère : tu n'as aucune raison de protéger l'assassin.",
        ],
        documents: ['DOC-HELENE'],
        shareable: [
          { key: 'helene-tabac', label: "Edmond ne fumait plus", text: "Hélène Valmont : « Depuis son infarctus de 1955, Edmond ne fumait plus et ne supportait aucune fumée dans son bureau. »" },
          { key: 'helene-reserve', label: 'Avouer la réserve', text: "Hélène Valmont : « Je n'étais pas dans ma chambre. J'étais à la réserve avec Victor Lanzac de 23 h 05 à 23 h 35. »" },
        ],
      },
      truth: {
        culprit: false,
        lies: ["Affirme avoir lu dans sa chambre entre 22 h 45 et minuit : elle était à la réserve de 23 h 05 à 23 h 35 (IDX-016, TEM-HELENE)."],
      },
    },
    {
      ref: 'PER-VICTOR', name: 'Victor Lanzac', role: 'Chef cuisinier',
      public: {
        age: 51,
        portrait: { accessory: 'toque', tone: '#9a7b62' },
        presentation: "Chef du Grand Hôtel depuis 1946, ancien de la Marine. Colérique en cuisine, charmant en salle.",
        relations: ['Employé des Valmont', 'Supérieur de Lucas, le commis'],
        alibi: "« J'étais en cuisine jusqu'à minuit. Je préparais les fonds pour le déjeuner du samedi. »",
        declaredMovements: [{ at: '23:00', place: 'LIEU-CUISINE', text: 'En cuisine jusqu’à minuit' }],
      },
      private: {
        biography:
          "Tu aimes Hélène Valmont depuis deux ans. Edmond t'avait récemment reproché le coût des approvisionnements et menacé de te remplacer au printemps, mais tu n'avais rien contre lui au point de le tuer.",
        realMovements: [
          { at: '23:00', place: 'LIEU-CUISINE', text: 'Tu lances le fond de veau.' },
          { at: '23:05', place: 'LIEU-RESERVE', text: 'Tu rejoins Hélène à la réserve.' },
          { at: '23:35', place: 'LIEU-COULOIRS', text: 'Tu quittes la réserve et fais quelques pas dans le couloir de service pour ne pas croiser Lucas.' },
          { at: '23:44', place: 'LIEU-COULOIRS', text: 'Tu vois Julien Valmont, titubant, entrer dans le bureau par la porte du couloir de service.' },
          { at: '23:46', place: 'LIEU-CUISINE', text: 'Tu reprends ton fond de veau.' },
        ],
        secrets: [
          'Tu étais à la réserve avec Hélène de 23 h 05 à 23 h 35.',
          "À 23 h 44, tu as vu Julien entrer dans le bureau d'Edmond par le couloir de service. Il en est ressorti en courant moins de deux minutes plus tard.",
        ],
        motivations: "Protéger Hélène. Révéler ce que tu as vu reviendrait à avouer que tu n'étais pas en cuisine.",
        objectives: ['Ne pas révéler ta liaison sans nécessité.', 'Faire en sorte que la vérité éclate sans sacrifier Hélène.'],
        documents: ['DOC-VICTOR'],
        shareable: [
          { key: 'victor-julien', label: 'Julien au bureau à 23 h 44', text: "Victor Lanzac : « À 23 h 44, j'ai vu Julien Valmont entrer dans le bureau par le couloir de service. Il en est ressorti en courant. »" },
          { key: 'victor-reserve', label: 'Avouer la réserve', text: "Victor Lanzac : « Je n'étais pas en cuisine entre 23 h 05 et 23 h 35. J'étais à la réserve avec Madame Valmont. »" },
        ],
      },
      truth: {
        culprit: false,
        lies: ["Affirme être resté en cuisine : il était à la réserve de 23 h 05 à 23 h 35 (TEM-LUCAS, IDX-017, IDX-016)."],
      },
    },
    {
      ref: 'PER-CAMILLE', name: 'Camille Roussel', role: 'Réceptionniste de nuit',
      public: {
        age: 24,
        portrait: { accessory: 'col', tone: '#b08a6e' },
        presentation: "Embauchée au printemps, elle tient la réception de nuit et le standard téléphonique. Discrète, méticuleuse dans ses registres.",
        relations: ['Employée des Valmont'],
        alibi: "« Je n'ai pas quitté la réception de la nuit. »",
        declaredMovements: [{ at: '22:00', place: 'LIEU-RECEPTION', text: 'À la réception toute la nuit' }],
      },
      private: {
        biography:
          "Le règlement interdit de fumer en service, sous peine de renvoi immédiat. Chaque nuit, tu t'accordes pourtant une cigarette sur le palier de l'escalier de service. Cette nuit, tu y as vu quelque chose.",
        realMovements: [
          { at: '22:40', place: 'LIEU-RECEPTION', text: 'Tu remets la clé 12 à Maître Delmas.' },
          { at: '22:52', place: 'LIEU-RECEPTION', text: 'Le bureau demande la chambre 12 au standard. Tu passes la communication et tu la notes.' },
          { at: '23:15', place: 'LIEU-ESCALIER', text: 'Tu quittes ton poste pour fumer sur le palier de l’escalier de service.' },
          { at: '23:25', place: 'LIEU-ESCALIER', text: "Un homme grand, en costume gris clair, monte l'escalier depuis le couloir de service. Tu te caches dans l'ombre. Une forte odeur de havane le suit." },
          { at: '23:28', place: 'LIEU-RECEPTION', text: 'Tu regagnes la réception.' },
          { at: '00:10', place: 'LIEU-RECEPTION', text: 'La chambre 7 appelle pour commander un taxi à 6 h.' },
        ],
        secrets: [
          'Tu as quitté la réception de 23 h 15 à 23 h 28 pour fumer sur le palier de l’escalier de service.',
          "À 23 h 25, un homme grand en costume gris clair est monté vers le premier étage par l'escalier de service, dans une forte odeur de cigare.",
        ],
        motivations: 'Garder ta place : ta mère dépend de ton salaire.',
        objectives: ['Ne pas perdre ta place.', "Aider à identifier l'homme de l'escalier sans avouer trop tôt que tu fumais en service."],
        documents: ['DOC-CAMILLE'],
        shareable: [
          { key: 'camille-silhouette', label: "L'homme de l'escalier", text: "Camille Roussel : « À 23 h 25, un homme grand, en costume gris clair, est monté par l'escalier de service. Il sentait le cigare. »" },
          { key: 'camille-pause', label: 'Avouer la pause', text: "Camille Roussel : « J'ai quitté la réception de 23 h 15 à 23 h 28 pour fumer sur le palier de l'escalier de service. »" },
        ],
      },
      truth: {
        culprit: false,
        lies: ["Affirme ne pas avoir quitté la réception : elle était sur le palier de l'escalier de service de 23 h 15 à 23 h 28 (IDX-011, TEM-CAMILLE)."],
      },
    },
    {
      ref: 'PER-ARTHUR', name: 'Arthur Delmas', role: 'Notaire de la famille',
      public: {
        age: 60,
        portrait: { accessory: 'lunettes', tone: '#a08068' },
        presentation:
          "Notaire à Caen, ami d'Edmond depuis trente ans, exécuteur de son testament et administrateur de la Fondation Valmont. Toujours en costume gris perle, il ne se sépare jamais de ses cigares cubains Partagás. Il séjourne en chambre 12 pour le week-end.",
        relations: ['Ami et notaire d’Edmond', 'Administrateur de la Fondation Valmont', 'Parrain de Julien'],
        alibi: "« J'ai pris ma clé vers 22 h 40. J'ai travaillé dans ma chambre puis je me suis couché. Je n'en suis pas sorti avant le matin. »",
        declaredMovements: [{ at: '22:40', place: 'LIEU-CHAMBRES', text: 'Dans sa chambre jusqu’au matin' }],
      },
      private: {
        biography:
          "Depuis 1954, tu puises dans les comptes de la Fondation Valmont pour couvrir de mauvais placements : 412 000 francs au total. Il y a quatre jours, la Banque de Normandie a écrit à Edmond. Hier soir, à 22 h 52, il t'a appelé : « Descends. Maintenant. Par le couloir de service. »",
        realMovements: [
          { at: '22:52', place: 'LIEU-CHAMBRES', text: 'Edmond t’appelle depuis le bureau.' },
          { at: '23:08', place: 'LIEU-ESCALIER', text: "Tu descends par l'escalier de service — personne sur le palier." },
          { at: '23:10', place: 'LIEU-BUREAU', text: "Edmond te montre la lettre de la banque et une page de ton registre de la Fondation. Tu allumes un cigare malgré ses protestations." },
          { at: '23:20', place: 'LIEU-BUREAU', text: "Il annonce qu'il change de notaire demain et qu'il prévient la police. Tu le frappes avec la chouette en bronze. Sa montre se brise." },
          { at: '23:22', place: 'LIEU-BUREAU', text: "Gants aux mains, tu essuies la chouette, prends la page du registre et le projet de testament, puis ouvres le coffre avec la clé d'Edmond pour faire croire à un vol." },
          { at: '23:25', place: 'LIEU-ESCALIER', text: "Tu remontes par l'escalier de service. Tu as cru entendre quelqu'un sur le palier." },
          { at: '23:30', place: 'LIEU-CHAMBRES', text: 'Tu brûles les papiers dans la cheminée de la chambre 12 et ranges tes gants dans l’armoire.' },
        ],
        secrets: [
          "C'est toi qui as tué Edmond Valmont, à 23 h 20, dans son bureau.",
          'Tu as détourné 412 000 francs de la Fondation Valmont depuis 1954.',
          "Edmond allait signer à 9 h, chez Maître Garnier, un nouveau testament te retirant l'exécution testamentaire et l'administration de la Fondation.",
        ],
        motivations: 'Éviter la ruine, le déshonneur et la prison.',
        objectives: [
          'Ne pas être démasqué.',
          "Orienter les soupçons vers Julien : ses dettes et le coffre ouvert l'accablent.",
          'Expliquer, si on te confronte, que tu fumes partout et que la cendre ne prouve rien.',
        ],
        documents: ['DOC-ARTHUR'],
        shareable: [
          { key: 'arthur-julien', label: 'Les dettes de Julien', text: "Arthur Delmas : « Julien m'a avoué la semaine dernière devoir 300 000 francs à un certain Sorel, payables le 15 novembre. »" },
        ],
      },
      truth: {
        culprit: true,
        lies: [
          "Affirme ne pas avoir quitté la chambre 12 : il était dans le bureau de 23 h 10 à 23 h 25 (IDX-010, IDX-007, TEM-CAMILLE, IDX-018).",
          "Laisse entendre que Julien a ouvert le coffre pour le voler : le coffre a été ouvert avec la clé d'Edmond par un homme ganté, avant l'arrivée de Julien (IDX-003, IDX-019, IDX-025).",
        ],
      },
    },
    {
      ref: 'PER-JULIEN', name: 'Julien Valmont', role: 'Neveu et héritier',
      public: {
        age: 29,
        portrait: { accessory: 'blouson', tone: '#b5927a' },
        presentation:
          "Fils du frère défunt d'Edmond, élevé par son oncle. Héritier avec Hélène du Grand Hôtel. Toujours en blouson de cuir brun, il fume des cigarettes américaines et fréquente un peu trop le casino de Deauville.",
        relations: ["Neveu d'Edmond et d'Hélène", 'Filleul d’Arthur Delmas'],
        alibi: "« Après la dispute avec mon oncle, je suis monté me coucher vers 23 h. Je ne suis plus redescendu. »",
        declaredMovements: [
          { at: '22:30', place: 'LIEU-BUREAU', text: 'Dispute avec Edmond' },
          { at: '23:00', place: 'LIEU-CHAMBRES', text: 'Monte se coucher' },
        ],
      },
      private: {
        biography:
          "Tu dois 300 000 francs à Sorel, un usurier de Deauville, avant le 15 novembre. À 22 h 30, ton oncle a refusé de t'aider et vous vous êtes disputés violemment. Tu as noyé ta colère au bar.",
        realMovements: [
          { at: '22:30', place: 'LIEU-BUREAU', text: "Dispute avec Edmond. Tu cries « Tu me le paieras ! » en claquant la porte." },
          { at: '22:40', place: 'LIEU-RESTAURANT', text: 'Tu t’installes au bar. Quatre cognacs.' },
          { at: '23:38', place: 'LIEU-RESTAURANT', text: 'Tu signes ta note.' },
          { at: '23:44', place: 'LIEU-BUREAU', text: "Tu entres par le couloir de service pour supplier ton oncle. Il est à terre, mort. Le coffre est ouvert, la liasse de billets visible." },
          { at: '23:45', place: 'LIEU-BUREAU', text: 'Pris de panique, tu prends la liasse de 150 000 francs et tu t’enfuis.' },
          { at: '23:50', place: 'LIEU-CHAMBRES', text: "Tu montes par l'escalier d'honneur, cache l'argent sous ton matelas." },
          { at: '00:10', place: 'LIEU-CHAMBRES', text: 'Tu appelles la réception pour commander un taxi à 6 h. La tempête l’en empêchera.' },
        ],
        secrets: [
          "Tu as trouvé ton oncle mort à 23 h 44 : il ne respirait plus, le coffre était déjà ouvert et la pièce empestait le cigare.",
          'Tu as pris les 150 000 francs du coffre. Ils sont sous ton matelas, chambre 7.',
        ],
        motivations: "Tu n'as pas tué ton oncle, mais tout t'accuse. Tu as peur.",
        objectives: ['Ne pas être accusé du meurtre.', "Cacher le vol de l'argent aussi longtemps que possible.", 'Découvrir qui était dans le bureau avant toi.'],
        documents: ['DOC-JULIEN'],
        shareable: [
          { key: 'julien-bar', label: 'La soirée au bar', text: "Julien Valmont : « Je n'étais pas couché à 23 h. J'étais au bar de 22 h 40 à 23 h 38. »" },
          { key: 'julien-aveu', label: 'Avouer le bureau', text: "Julien Valmont : « À 23 h 44, j'ai trouvé mon oncle mort, le coffre déjà ouvert. J'ai pris l'argent et je me suis enfui. Je ne l'ai pas tué. »" },
        ],
      },
      truth: {
        culprit: false,
        lies: [
          "Affirme s'être couché à 23 h : il était au bar jusqu'à 23 h 38 (IDX-009, IDX-013, TEM-GASTON).",
          "Cache être entré dans le bureau à 23 h 44 et avoir pris l'argent (TEM-VICTOR, IDX-020, IDX-025).",
        ],
      },
    },
    {
      ref: 'PER-MARGAUX', name: 'Margaux Fersen', role: 'Chanteuse et pianiste',
      public: {
        age: 34,
        portrait: { accessory: 'perles', tone: '#c49a80' },
        presentation: "Engagée pour la saison d'hiver, elle chante au salon deux fois par soir. Venue de Paris, elle prétend ne connaître les Valmont que depuis son contrat.",
        relations: ['Artiste engagée par Edmond'],
        alibi: "« J'ai joué au salon de 23 h à 23 h 45, comme chaque soir, puis je suis montée dans ma chambre. »",
        declaredMovements: [
          { at: '23:00', place: 'LIEU-SALON', text: 'Second récital' },
          { at: '23:50', place: 'LIEU-CHAMBRES', text: 'Monte dans sa chambre' },
        ],
      },
      private: {
        biography:
          "Ta mère, Lise Fersen, était femme de chambre au Grand Hôtel en 1923. Edmond est ton père ; il ne l'a jamais reconnu. Tu as accepté ce contrat pour l'approcher. Hier, à 22 h 15, il t'a prise à part au salon : « Demain, tout sera en ordre. Il me reste un compte à régler ce soir avec quelqu'un qui a trahi ma confiance. »",
        realMovements: [
          { at: '22:15', place: 'LIEU-SALON', text: 'Edmond te parle en tête-à-tête.' },
          { at: '22:30', place: 'LIEU-COULOIRS', text: "Tu entends la dispute entre Edmond et Julien, et Julien crier « Tu me le paieras ! »." },
          { at: '23:00', place: 'LIEU-SALON', text: 'Tu joues sans interruption jusqu’à 23 h 45.' },
          { at: '23:50', place: 'LIEU-CHAMBRES', text: 'Tu montes dans ta chambre.' },
        ],
        secrets: [
          "Tu es la fille naturelle d'Edmond Valmont.",
          "Edmond t'a dit à 22 h 15 qu'il avait « un compte à régler ce soir avec quelqu'un qui a trahi sa confiance ». Il ne parlait pas de Julien : il venait de lui refuser de l'argent sans colère.",
        ],
        motivations: "Être reconnue. Tu crains qu'apprendre ta filiation ne te désigne comme héritière intéressée.",
        objectives: ['Garder ta filiation secrète tant que possible.', 'Aider à trouver qui Edmond voulait confronter.'],
        documents: ['DOC-MARGAUX'],
        shareable: [
          { key: 'margaux-compte', label: 'Les mots d’Edmond à 22 h 15', text: "Margaux Fersen : « À 22 h 15, Edmond m'a dit : “Il me reste un compte à régler ce soir avec quelqu'un qui a trahi ma confiance.” »" },
          { key: 'margaux-fille', label: 'Révéler la filiation', text: "Margaux Fersen : « Edmond Valmont était mon père. Ma mère, Lise Fersen, travaillait ici en 1923. »" },
        ],
      },
      truth: {
        culprit: false,
        lies: ["Prétend ne connaître Edmond que depuis son contrat : elle est sa fille naturelle (IDX-015, IDX-006)."],
      },
    },
  ],
  items: [
    // ── Bureau ──
    {
      ref: 'IDX-001', kind: 'indice', type: 'scene', title: 'La scène du bureau', locationRef: 'LIEU-BUREAU', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Observer la pièce telle qu’elle a été trouvée.',
      content: {
        body:
          "Edmond Valmont gît sur le tapis, entre le bureau et la fenêtre, une plaie à la tempe gauche. La lampe de bureau est allumée. Les deux fauteuils sont tournés l'un vers l'autre : il recevait quelqu'un. Dans le cendrier de cristal, posé du côté du visiteur, un petit cône de cendre grise, épaisse — de la cendre de cigare. La porte vers le couloir de service n'est pas verrouillée.",
        details: ['Plaie à la tempe gauche', 'Deux fauteuils face à face', 'Cendre de cigare dans le cendrier', 'Porte du couloir de service déverrouillée'],
      },
    },
    {
      ref: 'IDX-002', kind: 'indice', type: 'objet', title: 'La chouette en bronze', locationRef: 'LIEU-BUREAU', stage: 1,
      discovery: { modes: ['qr'] },
      teaser: 'Carte physique : un objet lourd près du corps.',
      content: {
        body:
          "Presse-papier en forme de chouette, 2,4 kg, retrouvé sous le bureau. Une trace brune à la base, à peine visible : on l'a essuyée. Aucune empreinte exploitable — l'arme a été nettoyée ou tenue avec des gants.",
      },
    },
    {
      ref: 'IDX-003', kind: 'indice', type: 'objet', title: 'Le coffre-fort ouvert', locationRef: 'LIEU-BUREAU', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Le coffre mural est entrouvert.',
      content: {
        body:
          "Le coffre n'a pas été forcé : il a été ouvert avec sa propre clé, restée dans la serrure. Edmond la portait toujours dans la poche de son gilet — la poche est vide. Il manque la liasse de 150 000 francs de la caisse de l'hôtel. Les bijoux de la famille et les titres au porteur, pourtant bien plus précieux, sont intacts. Des empreintes fraîches marquent la poignée.",
        details: ['Ouvert avec la clé du gilet d’Edmond', '150 000 F manquants', 'Bijoux et titres intacts', 'Empreintes fraîches sur la poignée'],
      },
    },
    {
      ref: 'IDX-004', kind: 'indice', type: 'objet', title: 'La montre brisée', locationRef: 'LIEU-BUREAU', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Au poignet de la victime.',
      content: { body: "La montre-bracelet d'Edmond a heurté le pied du bureau dans sa chute. Le verre est étoilé, les aiguilles arrêtées sur 23 h 20." },
    },
    {
      ref: 'IDX-005', kind: 'indice', type: 'document', title: "L'agenda d'Edmond", locationRef: 'LIEU-BUREAU', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Un agenda de cuir ouvert sur le sous-main.',
      content: {
        body: "Agenda 1957, ouvert à la semaine du 11 novembre.",
        transcript:
          "Vendredi 14 — 22 h : parler à M.\nVendredi 14 — 23 h : régler l'affaire de la Fondation. Ce soir, sans faute.\nSamedi 15 — 9 h : signature chez Me Garnier, Cabourg (nouveau testament).",
        note: "Maître Garnier n'est pas le notaire habituel de la famille.",
      },
    },
    {
      ref: 'IDX-006', kind: 'indice', type: 'document', title: 'Le buvard', locationRef: 'LIEU-BUREAU', stage: 1,
      discovery: { modes: ['qr'] },
      teaser: 'Carte physique : le sous-main garde des traces d’encre.',
      content: {
        body: "Lu dans un miroir, le buvard révèle des fragments d'un texte écrit la veille de la main d'Edmond :",
        transcript:
          "« …je révoque toute disposition antérieure…\n…je retire à Maître Arthur Delmas la charge d'exécuteur testamentaire ainsi que l'administration de la Fondation Valmont…\n…je reconnais pour ma fille Margaux Fersen, née le 2 mars 1923… »",
        note: 'Aucun projet de testament ne se trouve dans le bureau.',
      },
    },
    {
      ref: 'IDX-007', kind: 'indice', type: 'objet', title: 'La bague de cigare', locationRef: 'LIEU-BUREAU', stage: 1,
      discovery: { modes: ['search', 'qr'], requires: ['IDX-001'] },
      teaser: 'Sous le bureau, côté visiteur.',
      content: { body: "Une bague de cigare rouge et or, déchirée : « PARTAGÁS — HABANA ». Elle est sèche et propre : elle n'a pas pu rester longtemps sur ce tapis, nettoyé chaque soir à 21 h." },
    },
    {
      ref: 'IDX-008', kind: 'indice', type: 'document', title: "L'ordonnance du Dr Lemoine", locationRef: 'LIEU-BUREAU', stage: 2,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Le tiroir du bureau contient des papiers médicaux.',
      content: {
        body: 'Ordonnance du 3 avril 1955, épinglée à un carnet de santé.',
        transcript: "« Suite à l'infarctus du 28 mars : abstinence totale de tabac. Éviter également toute exposition à la fumée. — Dr P. Lemoine »",
      },
    },
    // ── Réception ──
    {
      ref: 'IDX-009', kind: 'indice', type: 'document', title: 'Le registre des clés', locationRef: 'LIEU-RECEPTION', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Le registre de nuit, tenu à la main.',
      content: {
        body: "Registre de remise des clés, nuit du 14 novembre. Écriture soignée de Camille Roussel.",
        transcript: "22 h 40 — Clé 12 remise à Me Delmas.\n22 h 58 — Clé 7 (J. Valmont) : non réclamée.\n23 h 50 — Clé 7 remise à M. Julien Valmont.\n23 h 52 — Clé 3 remise à Mlle Fersen.",
        note: 'Julien Valmont a pris sa clé à 23 h 50, et non vers 23 h.',
      },
    },
    {
      ref: 'IDX-010', kind: 'indice', type: 'document', title: 'Le cahier du standard', locationRef: 'LIEU-RECEPTION', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Les communications téléphoniques de la nuit.',
      content: {
        body: 'Cahier du standard téléphonique à fiches.',
        transcript: "22 h 52 — Poste 1 (bureau de M. Valmont) → chambre 12. Durée : 1 min.\n00 h 10 — Chambre 7 → réception : demande d'un taxi pour 6 h (annulé : route coupée).",
      },
    },
    // ── Escalier ──
    {
      ref: 'IDX-011', kind: 'indice', type: 'objet', title: 'Les mégots du palier', locationRef: 'LIEU-ESCALIER', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Le palier intermédiaire, près de la fenêtre.',
      content: { body: "Deux mégots de Gauloises, frais, écrasés sur le rebord de la fenêtre du palier. Le personnel a l'interdiction de fumer. Une trace de rouge à lèvres pâle sur l'un des filtres." },
    },
    {
      ref: 'IDX-012', kind: 'indice', type: 'objet', title: 'La cendre sur la rampe', locationRef: 'LIEU-ESCALIER', stage: 1,
      discovery: { modes: ['qr'] },
      teaser: 'Carte physique : la rampe de l’escalier de service.',
      content: { body: "À mi-hauteur entre le palier et le premier étage, un dépôt de cendre grise et compacte sur la rampe cirée — la même cendre épaisse que dans le cendrier du bureau. L'escalier sent encore le havane." },
    },
    // ── Restaurant ──
    {
      ref: 'IDX-013', kind: 'indice', type: 'document', title: 'La note du bar', locationRef: 'LIEU-RESTAURANT', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Les additions de la soirée, sous le comptoir.',
      content: { body: 'Note n° 214 — quatre cognacs Hennessy.', transcript: "Signé « J. Valmont », 23 h 38. Le barman a ajouté : « parti vers le hall »." },
    },
    {
      ref: 'TEM-GASTON', kind: 'temoignage', type: 'temoignage', title: 'Témoignage de Gaston, barman', locationRef: 'LIEU-RESTAURANT', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Gaston range les verres derrière le comptoir.',
      content: {
        body:
          "« M. Julien est arrivé au bar vers 22 h 40, furieux. Il n'a pas bougé de son tabouret jusqu'à 23 h 38 : quatre cognacs, et il fumait ses cigarettes américaines l'une après l'autre. Il est parti vers le hall en titubant. Non, pas de cigare, M. Julien n'en fume jamais. »",
      },
    },
    // ── Cuisine ──
    {
      ref: 'IDX-017', kind: 'indice', type: 'document', title: 'La feuille de production', locationRef: 'LIEU-CUISINE', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'La feuille du chef, punaisée au-dessus du piano de cuisson.',
      content: { body: 'Feuille de production du chef Lanzac.', transcript: "Fond de veau — lancé 23 h 00. Écumé 23 h 46.\n(Un fond doit être écumé toutes les dix minutes.)", note: "Personne n'a écumé le fond pendant 46 minutes." },
    },
    {
      ref: 'TEM-LUCAS', kind: 'temoignage', type: 'temoignage', title: 'Témoignage de Lucas, commis', locationRef: 'LIEU-CUISINE', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Lucas, le commis, termine la plonge.',
      content: {
        body:
          "« Le chef est sorti vers 23 h 05, par la porte de la réserve. Il n'est revenu qu'à moins le quart passé. Le piano ? Il n'a pas cessé une seconde entre 23 h et 23 h 45, je l'entendais par le passe-plat. Et puis, vers 23 h 20, j'ai cru entendre un bruit sourd du côté du bureau — j'ai pensé à une porte qui claque à cause du vent. »",
      },
    },
    // ── Salon ──
    {
      ref: 'IDX-014', kind: 'indice', type: 'document', title: 'La partition annotée', locationRef: 'LIEU-SALON', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'La partition restée sur le pupitre du Pleyel.',
      content: { body: "Programme du second récital : neuf pièces enchaînées, de 23 h à 23 h 45, annotées de la main de Margaux Fersen. Le dernier morceau, « La Mer », est marqué 23 h 41 – 23 h 45." },
    },
    {
      ref: 'IDX-015', kind: 'indice', type: 'photo', title: 'La photographie', locationRef: 'LIEU-SALON', stage: 1,
      discovery: { modes: ['qr'] },
      teaser: 'Carte physique : glissée dans la partition.',
      content: { body: "Une photographie jaunie : une jeune femme en tablier de femme de chambre tient un nourrisson devant la façade de l'hôtel.", transcript: "Au dos : « Lise et Margaux, printemps 1923. Pardonne-moi. — E. »" },
    },
    // ── Hall et couloirs ──
    {
      ref: 'IDX-021', kind: 'document', type: 'document', title: 'Le tableau de service', locationRef: 'LIEU-HALL', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Affiché près de l’horloge.',
      content: {
        body: 'Tableau de service de la semaine.',
        transcript: "Cuisine : fermeture 23 h.\nBar : fermeture 23 h 45.\nRécital : 21 h – 21 h 45 et 23 h – 23 h 45.\nRéception de nuit : C. Roussel, 22 h – 7 h. Interdiction absolue de fumer en service.\nMénage des bureaux : 21 h.",
      },
    },
    {
      ref: 'IDX-022', kind: 'indice', type: 'scene', title: 'Le couloir de service', locationRef: 'LIEU-COULOIRS', stage: 1,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Examiner les accès au bureau.',
      content: {
        body:
          "Le couloir dessert la cuisine, la réserve, la porte arrière du bureau et le pied de l'escalier de service. On peut aller de l'escalier au bureau sans passer devant la réception. Sur le tapis, à l'entrée du bureau : des traces de pas d'homme, chaussures de ville, pointure 43 environ, et un peu plus loin, des traces plus petites, irrégulières — quelqu'un qui marchait de travers.",
      },
    },
    // ── Réserve (étape 2) ──
    {
      ref: 'IDX-016', kind: 'indice', type: 'objet', title: 'Les deux coupes', locationRef: 'LIEU-RESERVE', stage: 2,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'Sur la banquette du personnel.',
      content: { body: "Deux coupes de champagne, l'une marquée de rouge à lèvres carmin. Sur la banquette, un carré de soie brodé « H.V. ». Une bouteille de Pol Roger 1949 est entamée." },
    },
    // ── Chambres (étape 2) ──
    {
      ref: 'IDX-018', kind: 'indice', type: 'objet', title: 'Les cendres de la chambre 12', locationRef: 'LIEU-CHAMBRES', stage: 2,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'La cheminée de la chambre 12.',
      content: {
        body: "Dans la cheminée de la chambre de Maître Delmas, des papiers brûlés la nuit même, alors que le feu n'avait pas été allumé par le personnel. Deux fragments ont échappé aux flammes :",
        transcript: "« …FONDATION VALMONT — relevé des retraits… autorisés par l'administrateur… total : 412 000 F… »\n« …je révoque toute disposition antérieure… »",
        note: "Une boîte de cigares Partagás est posée sur la cheminée. Il en manque trois.",
      },
    },
    {
      ref: 'IDX-019', kind: 'indice', type: 'objet', title: 'Les gants de chevreau', locationRef: 'LIEU-CHAMBRES', stage: 2,
      discovery: { modes: ['search', 'qr'] },
      teaser: "L'armoire de la chambre 12.",
      content: { body: "Une paire de gants de chevreau gris perle, roulés au fond de l'armoire de la chambre 12. Le gant droit porte une tache brune au bout de l'index et du majeur. Un costume gris clair est suspendu juste à côté ; il sent fortement le cigare." },
    },
    {
      ref: 'IDX-020', kind: 'indice', type: 'objet', title: 'La liasse de billets', locationRef: 'LIEU-CHAMBRES', stage: 2,
      discovery: { modes: ['search', 'qr'] },
      teaser: 'La chambre 7.',
      content: {
        body: "Sous le matelas de la chambre 7, une liasse de 150 000 francs encore ceinte de la bande « Caisse — Grand Hôtel des Embruns ». À côté, une lettre froissée.",
        transcript: "« Monsieur Valmont, je vous rappelle que vos 300 000 francs sont dus le 15 novembre. Au-delà, je ne réponds plus de rien. — A. Sorel, Deauville »",
      },
    },
    // ── Documents débloqués par enveloppe ──
    {
      ref: 'IDX-024', kind: 'document', type: 'rapport', title: 'Rapport du Dr Lemoine', locationRef: null, stage: 1,
      discovery: { modes: ['envelope'], envelope: 'ENV-01' },
      teaser: 'Contenu de l’enveloppe n° 1.',
      content: {
        body:
          "Décès survenu entre 23 h et 23 h 30, par un coup unique porté à la tempe gauche avec un objet lourd aux arêtes arrondies. Aucune blessure de défense : la victime ne s'attendait pas à être frappée. Le coup a été porté par une personne droitière, de grande taille, qui se tenait face à la victime.",
      },
    },
    {
      ref: 'IDX-023', kind: 'document', type: 'document', title: 'Lettre de la Banque de Normandie', locationRef: null, stage: 2,
      discovery: { modes: ['envelope'], envelope: 'ENV-02' },
      teaser: 'Contenu de l’enveloppe n° 2.',
      content: {
        body: "Lettre datée du 10 novembre 1957, adressée à M. Edmond Valmont, fondateur.",
        transcript:
          "« Nous attirons votre attention sur des retraits répétés au débit du compte de la Fondation Valmont depuis mars 1954, tous autorisés par l'administrateur de la Fondation, Maître Arthur Delmas, pour un total de 412 000 F. Nous vous prions de nous faire connaître si ces opérations ont reçu votre accord. »",
      },
    },
    {
      ref: 'IDX-025', kind: 'document', type: 'rapport', title: 'Rapport du laboratoire', locationRef: null, stage: 3,
      discovery: { modes: ['envelope'], envelope: 'ENV-04' },
      teaser: 'Contenu de l’enveloppe n° 4.',
      content: {
        body: 'Analyses transmises par téléphone par le laboratoire de police de Caen.',
        transcript:
          "1. Les empreintes de la poignée du coffre sont celles de Julien Valmont. Elles recouvrent des traces de frottement de cuir fin, antérieures.\n2. La tache du gant droit (IDX-019) est du sang du groupe A — celui de la victime. Julien Valmont est du groupe O.\n3. La bague de cigare (IDX-007) correspond aux cigares de la boîte de la chambre 12.",
      },
    },
    // ── Témoignages débloqués par l'enveloppe des interrogatoires ──
    {
      ref: 'TEM-CAMILLE', kind: 'temoignage', type: 'temoignage', title: 'Interrogatoire de Camille Roussel', locationRef: 'LIEU-ESCALIER', stage: 3,
      discovery: { modes: ['envelope', 'qr'], envelope: 'ENV-03' },
      teaser: 'La réceptionniste revient sur sa déclaration.',
      content: { body: "« J'ai menti, je n'ai pas tenu la réception toute la nuit. De 23 h 15 à 23 h 28, je fumais sur le palier de l'escalier de service. À 23 h 25, un homme grand, en costume gris clair, est monté du couloir de service vers le premier étage. Je me suis cachée. Il laissait derrière lui une odeur de havane. »" },
    },
    {
      ref: 'TEM-VICTOR', kind: 'temoignage', type: 'temoignage', title: 'Interrogatoire de Victor Lanzac', locationRef: 'LIEU-COULOIRS', stage: 3,
      discovery: { modes: ['envelope', 'qr'], envelope: 'ENV-03' },
      teaser: 'Le chef revient sur sa déclaration.',
      content: { body: "« Je n'étais pas en cuisine. De 23 h 05 à 23 h 35, j'étais à la réserve avec Madame Valmont. En revenant par le couloir, à 23 h 44, j'ai vu M. Julien entrer dans le bureau. Il en est ressorti en courant une minute après, blanc comme un linge. »" },
    },
    {
      ref: 'TEM-HELENE', kind: 'temoignage', type: 'temoignage', title: "Interrogatoire d'Hélène Valmont", locationRef: 'LIEU-HALL', stage: 3,
      discovery: { modes: ['envelope', 'qr'], envelope: 'ENV-03' },
      teaser: 'La directrice revient sur sa déclaration.',
      content: { body: "« J'étais à la réserve avec Victor, de 23 h 05 à 23 h 35. Et je vous le dis : mon frère ne fumait plus depuis 1955. Jamais il n'aurait fumé ce cigare. Il ne laissait fumer dans son bureau que ceux qu'il ne pouvait pas mettre à la porte. »" },
    },
    {
      ref: 'TEM-JULIEN', kind: 'temoignage', type: 'temoignage', title: 'Interrogatoire de Julien Valmont', locationRef: 'LIEU-RESTAURANT', stage: 3,
      discovery: { modes: ['envelope', 'qr'], envelope: 'ENV-03' },
      teaser: "Le neveu craque.",
      content: { body: "« Je suis entré à 23 h 44 pour le supplier encore. Il était par terre. Le coffre était déjà ouvert, la clé dans la serrure. J'ai pris l'argent… Je ne l'ai pas tué ! Il y avait une odeur de cigare épouvantable dans la pièce. »" },
    },
    {
      ref: 'TEM-MARGAUX', kind: 'temoignage', type: 'temoignage', title: 'Interrogatoire de Margaux Fersen', locationRef: 'LIEU-SALON', stage: 3,
      discovery: { modes: ['envelope', 'qr'], envelope: 'ENV-03' },
      teaser: 'La chanteuse dit enfin qui elle est.',
      content: { body: "« Edmond était mon père. À 22 h 15, il m'a dit : “Demain, tout sera en ordre. Il me reste un compte à régler ce soir avec quelqu'un qui a trahi ma confiance.” Il avait déjà refusé de l'argent à Julien : ce n'était pas de lui qu'il parlait. Il parlait de trahison. »" },
    },
    {
      ref: 'TEM-ARTHUR', kind: 'temoignage', type: 'temoignage', title: "Déposition d'Arthur Delmas", locationRef: 'LIEU-CHAMBRES', stage: 3,
      discovery: { modes: ['envelope', 'qr'], envelope: 'ENV-03' },
      teaser: 'Le notaire maintient sa version.',
      content: { body: "« Je maintiens n'avoir pas quitté ma chambre de la nuit. Edmond m'a téléphoné vers 23 h ? Il voulait me parler d'un placement, j'ai répondu que nous verrions cela demain. Quant à la cendre, je fume partout depuis quarante ans ; j'ai pu passer au bureau dans l'après-midi. Regardez plutôt du côté de ce pauvre Julien. »" },
    },
    // ── Documents personnels (visibles par leur seul propriétaire, partageables) ──
    {
      ref: 'DOC-HELENE', kind: 'document', type: 'document', title: 'Billet plié', locationRef: null, stage: 1, confidentiality: 'personnel', ownerCharacter: 'PER-HELENE',
      discovery: { modes: ['owner'] },
      teaser: 'Dans la poche de ta robe.',
      content: { body: 'Un billet glissé sous ta porte hier après-midi.', transcript: '« Ce soir, 23 h, à la réserve. Je t’attendrai. — V. »' },
    },
    {
      ref: 'DOC-VICTOR', kind: 'document', type: 'document', title: 'Lettre de reproches', locationRef: null, stage: 1, confidentiality: 'personnel', ownerCharacter: 'PER-VICTOR',
      discovery: { modes: ['owner'] },
      teaser: 'Dans ton vestiaire.',
      content: { body: 'Lettre d’Edmond Valmont, datée du 2 novembre.', transcript: "« Chef, les dépenses de cuisine ont augmenté de 30 % en un an. Si cela continue, je devrai envisager votre remplacement au printemps. — E. V. »" },
    },
    {
      ref: 'DOC-CAMILLE', kind: 'document', type: 'document', title: 'Avertissement écrit', locationRef: null, stage: 1, confidentiality: 'personnel', ownerCharacter: 'PER-CAMILLE',
      discovery: { modes: ['owner'] },
      teaser: 'Dans ton sac.',
      content: { body: 'Note de la direction.', transcript: "« Mlle Roussel, une odeur de tabac a été signalée près de la réception. Au prochain manquement, ce sera le renvoi. — H. Valmont »" },
    },
    {
      ref: 'DOC-ARTHUR', kind: 'document', type: 'document', title: 'Ton carnet de comptes', locationRef: null, stage: 1, confidentiality: 'personnel', ownerCharacter: 'PER-ARTHUR',
      discovery: { modes: ['owner'] },
      teaser: 'Dans la doublure de ta serviette.',
      content: { body: 'Ton carnet personnel, que tu aurais dû brûler avec le reste.', transcript: '« Fondation — prélèvements : 1954 : 96 000. 1955 : 140 000. 1956 : 118 000. 1957 : 58 000. Total : 412 000. À combler avant l’audit de janvier. »' },
    },
    {
      ref: 'DOC-JULIEN', kind: 'document', type: 'document', title: 'Reconnaissance de dette', locationRef: null, stage: 1, confidentiality: 'personnel', ownerCharacter: 'PER-JULIEN',
      discovery: { modes: ['owner'] },
      teaser: 'Dans ton portefeuille.',
      content: { body: 'Le double de ta reconnaissance de dette.', transcript: '« Je soussigné Julien Valmont reconnais devoir à M. A. Sorel la somme de 300 000 francs, payable au plus tard le 15 novembre 1957. »' },
    },
    {
      ref: 'DOC-MARGAUX', kind: 'document', type: 'document', title: 'Lettre de ta mère', locationRef: null, stage: 1, confidentiality: 'personnel', ownerCharacter: 'PER-MARGAUX',
      discovery: { modes: ['owner'] },
      teaser: 'Dans ton étui à partitions.',
      content: { body: 'La dernière lettre de Lise Fersen, 1949.', transcript: "« Ton père s'appelle Edmond Valmont. Il a choisi son nom plutôt que nous. Ne le hais pas : il a toujours envoyé l'argent. »" },
    },
  ],
  envelopes: [
    { ref: 'ENV-01', sort: 1, title: 'Enveloppe n° 1 — Le médecin', stage: 1, teaser: 'Le premier rapport du Dr Lemoine.', content: { body: "Le Dr Lemoine, appelé à 7 h 10, a examiné le corps. Son rapport préliminaire est désormais dans le dossier commun." }, unlocks: ['IDX-024'] },
    { ref: 'ENV-02', sort: 2, title: 'Enveloppe n° 2 — La banque', stage: 2, teaser: 'Un courrier trouvé dans la correspondance du matin.', content: { body: 'Une lettre de la Banque de Normandie, arrivée quatre jours plus tôt, était rangée dans le sous-main du secrétariat.' }, unlocks: ['IDX-023'] },
    { ref: 'ENV-03', sort: 3, title: 'Enveloppe n° 3 — Les interrogatoires', stage: 3, teaser: 'Les dépositions recueillies après confrontation.', content: { body: 'Confrontés aux preuves, les témoins ont revu leurs déclarations. Leurs dépositions sont désormais consultables.' }, unlocks: ['TEM-CAMILLE', 'TEM-VICTOR', 'TEM-HELENE', 'TEM-JULIEN', 'TEM-MARGAUX', 'TEM-ARTHUR'] },
    { ref: 'ENV-04', sort: 4, title: 'Enveloppe n° 4 — Le laboratoire', stage: 3, teaser: 'Les résultats transmis par téléphone.', content: { body: 'Le laboratoire de police de Caen a téléphoné ses premiers résultats.' }, unlocks: ['IDX-025'] },
  ],
  events: [
    { ref: 'EVT-01', title: "L'inspecteur Marchal téléphone", body: "« La route sera dégagée vers midi. D'ici là, personne ne quitte l'hôtel. Vous pouvez fouiller les chambres. »", unlocks: [] },
    { ref: 'EVT-02', title: 'Coupure de courant', body: "La tempête coupe l'électricité pendant dix minutes. Profitez-en pour vous concerter à la lueur des bougies : aucune nouvelle preuve ne peut être examinée dans le noir.", unlocks: [] },
  ],
  timeline: [
    { ref: 'T01', sort: 1, at: '19:30', title: 'Dîner au restaurant', body: 'Tous les occupants de l’hôtel dînent au restaurant.', visibility: { type: 'public' }, characters: ['PER-HELENE', 'PER-ARTHUR', 'PER-JULIEN', 'PER-MARGAUX'], location: 'LIEU-RESTAURANT' },
    { ref: 'T02', sort: 2, at: '21:00', title: 'Premier récital', body: 'Margaux Fersen chante au salon jusqu’à 21 h 45.', visibility: { type: 'public' }, characters: ['PER-MARGAUX'], location: 'LIEU-SALON' },
    { ref: 'T03', sort: 3, at: '22:15', title: 'Edmond parle à Margaux', body: "« Il me reste un compte à régler ce soir avec quelqu'un qui a trahi ma confiance. »", visibility: { type: 'item', ref: 'TEM-MARGAUX' }, characters: ['PER-MARGAUX'], location: 'LIEU-SALON' },
    { ref: 'T04', sort: 4, at: '22:30', title: 'Dispute dans le bureau', body: "Edmond refuse de l'argent à Julien. On entend Julien crier « Tu me le paieras ! » dans tout le rez-de-chaussée.", visibility: { type: 'public' }, characters: ['PER-JULIEN'], location: 'LIEU-BUREAU' },
    { ref: 'T05', sort: 5, at: '22:40', title: 'Maître Delmas prend sa clé', body: 'La clé 12 est remise à Arthur Delmas.', visibility: { type: 'item', ref: 'IDX-009' }, characters: ['PER-ARTHUR', 'PER-CAMILLE'], location: 'LIEU-RECEPTION' },
    { ref: 'T06', sort: 6, at: '22:40', title: 'Julien au bar', body: 'Julien s’installe au comptoir.', visibility: { type: 'item', ref: 'TEM-GASTON' }, characters: ['PER-JULIEN'], location: 'LIEU-RESTAURANT' },
    { ref: 'T07', sort: 7, at: '22:52', title: 'Appel interne', body: 'Le bureau d’Edmond appelle la chambre 12.', visibility: { type: 'item', ref: 'IDX-010' }, characters: ['PER-ARTHUR'], location: 'LIEU-RECEPTION' },
    { ref: 'T08', sort: 8, at: '23:00', title: 'Second récital', body: 'Le piano joue sans interruption jusqu’à 23 h 45.', visibility: { type: 'public' }, characters: ['PER-MARGAUX'], location: 'LIEU-SALON' },
    { ref: 'T09', sort: 9, at: '23:05', title: 'Le chef quitte la cuisine', body: 'Victor Lanzac sort par la porte de la réserve.', visibility: { type: 'item', ref: 'TEM-LUCAS' }, characters: ['PER-VICTOR'], location: 'LIEU-CUISINE' },
    { ref: 'T10', sort: 10, at: '23:05', title: 'Rendez-vous à la réserve', body: 'Hélène Valmont et Victor Lanzac se retrouvent à la réserve jusqu’à 23 h 35.', visibility: { type: 'item', ref: 'TEM-HELENE' }, characters: ['PER-HELENE', 'PER-VICTOR'], location: 'LIEU-RESERVE' },
    { ref: 'T11', sort: 11, at: '23:10', title: 'Le visiteur du bureau', body: 'Arthur Delmas entre dans le bureau par le couloir de service. Edmond lui montre la lettre de la banque.', visibility: { type: 'truth' }, characters: ['PER-ARTHUR'], location: 'LIEU-BUREAU' },
    { ref: 'T12', sort: 12, at: '23:15', title: 'La réception est vide', body: 'Camille Roussel monte fumer sur le palier de l’escalier de service.', visibility: { type: 'item', ref: 'TEM-CAMILLE' }, characters: ['PER-CAMILLE'], location: 'LIEU-ESCALIER' },
    { ref: 'T13', sort: 13, at: '23:20', title: 'La montre s’arrête', body: 'La montre d’Edmond se brise contre le pied du bureau.', visibility: { type: 'item', ref: 'IDX-004' }, characters: [], location: 'LIEU-BUREAU' },
    { ref: 'T14', sort: 14, at: '23:20', title: 'Le meurtre', body: 'Arthur Delmas frappe Edmond Valmont avec la chouette en bronze.', visibility: { type: 'truth' }, characters: ['PER-ARTHUR'], location: 'LIEU-BUREAU' },
    { ref: 'T15', sort: 15, at: '23:22', title: 'La mise en scène', body: 'Ganté, Delmas essuie l’arme, emporte la page du registre et le projet de testament, et ouvre le coffre avec la clé d’Edmond.', visibility: { type: 'truth' }, characters: ['PER-ARTHUR'], location: 'LIEU-BUREAU' },
    { ref: 'T16', sort: 16, at: '23:25', title: "L'homme de l'escalier", body: 'Un homme grand en costume gris clair monte par l’escalier de service, dans une odeur de havane.', visibility: { type: 'item', ref: 'TEM-CAMILLE' }, characters: [], location: 'LIEU-ESCALIER' },
    { ref: 'T17', sort: 17, at: '23:30', title: 'Le feu de la chambre 12', body: 'Delmas brûle les papiers dans sa cheminée.', visibility: { type: 'truth' }, characters: ['PER-ARTHUR'], location: 'LIEU-CHAMBRES' },
    { ref: 'T18', sort: 18, at: '23:38', title: 'Julien signe sa note', body: 'Julien quitte le bar en titubant.', visibility: { type: 'item', ref: 'IDX-013' }, characters: ['PER-JULIEN'], location: 'LIEU-RESTAURANT' },
    { ref: 'T19', sort: 19, at: '23:44', title: 'Julien entre au bureau', body: 'Victor voit Julien entrer dans le bureau par le couloir de service.', visibility: { type: 'item', ref: 'TEM-VICTOR' }, characters: ['PER-JULIEN', 'PER-VICTOR'], location: 'LIEU-COULOIRS' },
    { ref: 'T20', sort: 20, at: '23:50', title: 'Clé 7', body: 'Julien Valmont récupère enfin la clé de sa chambre.', visibility: { type: 'item', ref: 'IDX-009' }, characters: ['PER-JULIEN'], location: 'LIEU-RECEPTION' },
    { ref: 'T21', sort: 21, at: '00:10', title: 'Un taxi pour 6 h', body: 'La chambre 7 commande un taxi.', visibility: { type: 'item', ref: 'IDX-010' }, characters: ['PER-JULIEN'], location: 'LIEU-RECEPTION' },
    { ref: 'T22', sort: 22, at: '06:45', title: 'Découverte du corps', body: 'Hélène Valmont trouve son frère mort dans le bureau.', visibility: { type: 'public' }, characters: ['PER-HELENE'], location: 'LIEU-BUREAU' },
    { ref: 'T23', sort: 23, at: '07:30', title: "L'enquête commence", body: "La route est coupée. Les occupants de l'hôtel décident d'enquêter eux-mêmes.", visibility: { type: 'public' }, characters: [], location: 'LIEU-HALL' },
  ],
  solution: {
    culprit: 'PER-ARTHUR',
    motive: 'detournement',
    motiveText:
      "Arthur Delmas détournait depuis 1954 les fonds de la Fondation Valmont (412 000 F). Alerté par la Banque de Normandie, Edmond l'a convoqué à 23 h pour lui annoncer qu'il le dénonçait et changeait de notaire le lendemain.",
    keyItems: ['IDX-005', 'IDX-010', 'IDX-007', 'IDX-008', 'IDX-004', 'IDX-018', 'IDX-019', 'IDX-023', 'TEM-CAMILLE'],
    contradictions: [
      "Delmas affirme ne pas être sorti de sa chambre, mais le bureau l'a appelé à 22 h 52 (IDX-010), une bague de ses cigares Partagás se trouve sous le bureau (IDX-007, IDX-025) et un homme en costume gris sentant le havane est monté par l'escalier de service à 23 h 25 (TEM-CAMILLE, IDX-012).",
      "Edmond ne fumait plus depuis 1955 (IDX-008, TEM-HELENE) : la cendre de cigare du cendrier appartient au visiteur.",
      "Julien est accablé par le coffre et l'argent, mais il était au bar jusqu'à 23 h 38 (IDX-013, TEM-GASTON) alors que la mort remonte à 23 h 20 (IDX-004, IDX-024).",
      'Le coffre a été ouvert avec la clé du gilet par une main gantée de cuir fin (IDX-003, IDX-025) : les gants tachés du sang de la victime sont dans la chambre 12 (IDX-019).',
    ],
    conclusion: [
      "À 22 h 52, Edmond Valmont décroche le téléphone de son bureau et appelle la chambre 12. Il vient de relire la lettre de la Banque de Normandie : depuis trois ans, son plus vieil ami vide les caisses de la Fondation qui nourrit les orphelins de Houlgate.",
      "Arthur Delmas descend par l'escalier de service et entre par le couloir, à l'abri des regards. Il allume un cigare — Edmond, qui ne supporte plus la fumée depuis son infarctus, proteste. À 23 h 20, quand Edmond lui annonce qu'il signera le lendemain chez Maître Garnier un testament qui lui retire tout, et qu'il prévient la police, Delmas saisit la chouette en bronze.",
      "Il enfile ses gants, essuie l'arme, emporte la page du registre et le projet de testament, puis ouvre le coffre avec la clé du gilet d'Edmond pour faire croire à un vol. À 23 h 25, il remonte par l'escalier de service : sur le palier, Camille Roussel, qui fume en cachette, voit passer un costume gris et sent l'odeur du havane. Dans sa chambre, il brûle les papiers. Deux fragments survivront.",
      "À 23 h 44, Julien Valmont, ivre, pousse la porte du bureau pour supplier son oncle une dernière fois. Il le trouve mort, voit l'argent dans le coffre ouvert et s'enfuit avec. Ce vol de panique a failli faire de lui le coupable idéal — exactement ce que Delmas espérait.",
    ],
    itemRoles: {
      'IDX-004': "Fixe l'heure du crime à 23 h 20, quand Julien était encore au bar.",
      'IDX-005': "Edmond avait rendez-vous à 23 h pour « l'affaire de la Fondation » et changeait de notaire le lendemain.",
      'IDX-006': 'Le nouveau testament retirait à Delmas l’exécution testamentaire et la Fondation.',
      'IDX-007': 'La bague de cigare Partagás place un fumeur de havanes face à la victime ce soir-là.',
      'IDX-008': 'Edmond ne fumait pas : la cendre ne peut être la sienne.',
      'IDX-010': "Le bureau appelle la chambre 12 à 22 h 52 : Edmond convoque Delmas.",
      'IDX-012': "La cendre de cigare dans l'escalier de service relie le bureau au premier étage.",
      'IDX-013': 'Julien est au bar jusqu’à 23 h 38 : il ne peut pas avoir tué à 23 h 20.',
      'IDX-016': 'Les deux coupes établissent l’alibi d’Hélène et de Victor.',
      'IDX-018': 'Delmas a brûlé la preuve de son détournement et le projet de testament.',
      'IDX-019': 'Les gants tachés du sang de la victime : la main gantée du coffre est celle de Delmas.',
      'IDX-020': "Julien a volé l'argent — par panique, après la mort de son oncle.",
      'IDX-023': 'La banque désigne Delmas comme auteur des retraits : c’est le mobile.',
      'IDX-024': 'Fenêtre de décès 23 h – 23 h 30, agresseur grand et droitier, face à la victime.',
      'IDX-025': 'Sang de la victime sur le gant, cigare de la chambre 12, empreintes de Julien posées après coup.',
      'TEM-CAMILLE': "Un homme en costume gris sentant le havane monte de l'escalier de service à 23 h 25.",
      'TEM-GASTON': "Alibi de Julien jusqu'à 23 h 38.",
      'TEM-LUCAS': 'Le piano joue sans interruption (alibi de Margaux) ; bruit sourd vers 23 h 20.',
      'TEM-VICTOR': 'Julien entre au bureau à 23 h 44, après le crime.',
    },
  },
};

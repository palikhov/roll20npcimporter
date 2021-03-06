/**
 * @author Felix Müller aka syl3r86
 * @version 0.3.4
 */

class Roll20NpcImporter extends Application {

    constructor(app) {
        super(app);

        this.hookActorList();

        // setting some default options here, change to your liking. Options will be available in the app too

        this.reactionsAsAttacks = false; // if false, reactions will be added to feats, true means weapons/attacks
        this.reactionPrefix = 'RE - '; // prefix used for reactions

        this.legendaryAsAttacks = false;  // if false, legendary actions will be added to feats, true means weapons/attacks
        this.legendaryPrefix = 'LA - '; // prefix used for legendary Actions

        this.lairAsAttacks = false;
        this.lairPrefix = 'Lair Action';

        this.regionalAsAttacks = false;
        this.regionalPrefix = 'Regional Effect';

        this.defaultHealth = 10; // default health used if all else failed

        this.showTokenName = 20; // 0=no, 1=control, 2=hover, 3=always, 20=owner hover, 40=owner
        this.showTokenBars = 40;

        this.tokenBar1Link = 'attributes.hp';
        this.tokenBar2Link = '';

        this.defaultSource = 'Roll20 Importer';

        this.showMissingAttribError = false;

        this.useTokenAsAvatar = false;
        this.ignoreTokenLight = false;

        this.isOgl = true;
    }

    static get defaultOptions() {
        const options = super.defaultOptions;
        options.template = "public/modules/roll20npcimporter/template/roll20npcimporter.html";
        options.width = 500;
        options.height = "auto";
        return options;
    }

    getData() {
        let tokenDisplayMode = [];
        for (let key in TOKEN_DISPLAY_MODES) {
            let modeString = key.toLowerCase();
            modeString = modeString.replace('_', ' ');
            modeString = this.fixUpperCase(modeString);//.replace(/(^|\s)([a-z])/g, function (m, p1, p2) { return p1 + p2.toUpperCase(); });
            tokenDisplayMode.push({ name: modeString, value: TOKEN_DISPLAY_MODES[key] });
        };

        let actorCompendie = [];
        let spellCompendie = [];
        spellCompendie.push({ name: 'None', value: 'noComp' });
        for (let compendium of game.packs) {
            if (compendium['metadata']['entity'] == "Actor" && compendium['metadata']['module'] == 'world') {
                actorCompendie.push({ name: compendium['metadata']['label'], value: compendium.collection})
            }
            if (compendium['metadata']['entity'] == "Item") {
                spellCompendie.push({ name: compendium['metadata']['label'], value: compendium.collection })
            }
        }

        let options = {
            legendaryPrefix: this.legendaryPrefix,
            reactionPrefix: this.reactionPrefix,        
            defaultHealth: this.defaultHealth, 
            defaultSource: this.defaultSource,
            useTokenAsAvatar: this.useTokenAsAvatar,
            ignoreTokenLight: this.ignoreTokenLight,
            tokenBar1Link: this.tokenBar1Link,
            tokenBar2Link: this.tokenBar2Link,
            displayModes: tokenDisplayMode,
            defaultNameDisplay: tokenDisplayMode[2]['value'],
            defaultBarDisplay: tokenDisplayMode[4]['value'],
            actorCompendie: actorCompendie,
            spellCompendie: spellCompendie
        }
        return options;
    }

    activateListeners(html) {
        html.find("select[name=compendiumName]").parent().hide();

        let nav = html.find('.tabs');
        new Tabs(nav, {
            initial: "import"
        }); //,        callback: t => console.log(t)

        $(".startImport").click(async (ev) => {
            ev.preventDefault();
            this.legendaryPrefix = html.find("input[name=legendaryPrefix]").val();
            this.reactionPrefix = html.find("input[name=reactionPrefix]").val();
            this.defaultHealth = html.find("input[name=defaultHealth]").val();
            this.defaultSource = html.find("input[name=defaultSource]").val();
            this.useTokenAsAvatar = html.find("input[name=useTokenAsAvatar]").prop("checked");

            this.showTokenName = html.find("select[name=showNameMode]").val();
            this.showTokenBars = html.find("select[name=showBarMode]").val();
            this.ignoreTokenLight = html.find("input[name=ignoreTokenLight]").prop("checked");

            this.tokenBar1Link = html.find("select[name=tokenBar1Link]").val();
            this.tokenBar2Link = html.find("select[name=tokenBar2Link]").val();

            let targetMode = html.find("select[name=targetMode]").val();
            let targetCompendium = html.find("select[name=compendiumName]").val();
            let spellCompendium = html.find("select[name=spellCompendiumName]").val();
            if (spellCompendium == 'noComp') {
                this.spellCompendium = null;
            } else {
                this.spellCompendium = game.packs.find(p => p.collection === spellCompendium);
                await this.spellCompendium.getIndex();
            }

            let files = html.find("input[name=fileUploads]").prop('files');

            let npcs = [];

            try {
                await this.loadFiles(files, npcs);
            } catch (e) {
                console.log('NPCImporter | There was a problem loading the files');
                console.log(e.message);
            }

            let npcString = html.find(".npc-data").val();
            if (npcString != undefined && npcString != '')
                npcs.push(npcString);

            for (let npc of npcs) {
                this.importNpc(npc, targetMode, targetCompendium);
            }
            this.close();
            Promise.resolve();
        });

        html.find('select[name=targetMode]').change(val => {
            if (html.find('select[name=targetMode]').val() == 'actor') {
                html.find("select[name=compendiumName]").parent().hide(250);
            } else {
                html.find("select[name=compendiumName]").parent().show(250);
            }
        });
    }

    /**
     * Hook into the render call for the ActorList to add an extra button
     */
    hookActorList() {
        Hooks.on('renderActorList', (app, html, data) => {
            const importButton = $('<button class="roll20-npc-import-list-btn" style="min-width: 96%;"><i class="fas fa-file-import"></i> NPC Import</button>');

            html.find('.roll20-npc-import-list-btn').remove();
            html.find('.directory-footer').append(importButton);

            // Handle button clicks
            importButton.click(ev => {
                ev.preventDefault();
                this.render(true);
                //this.showImportDialog();
            });
        });
    }

    /**
     * Import the character data into a preexisting or new actor.
     * @param {String} sheetData - a JSON string representing the character Data
     * @param {Object} actor - the actor into which to put the data
     * */
    async importNpc(sheetData, targetMode, compendiumName = '') {
        // check valid JSON string
        let npcData = null;
        try {
            npcData = JSON.parse(sheetData);
        } catch (e) {
            console.error("Invalid JSON, unable to parse");
            console.error(e.message);
            return;
        }

        // check if its an ogl or shaped sheet
        let sheet = this.getAttribute(npcData.attribs, 'character_sheet');
        if (sheet != false && sheet.indexOf('Shaped') != -1) {
            this.isOgl = false;
        } else {
            this.isOgl = true;
        }

        // check if its an NPC thats being imported
        if (this.getAttribute(npcData.attribs, 'npc') != '1') {
            console.error("Invalid JSON, the character is not an NPC");
            return;
        }

        // create actor if required
        // TODO: change this part for compendium storage
        let actor = null;
        if (targetMode == 'compendium') {
            if (compendiumName != '') {
                let compendium = game.packs.find(p => p.collection === compendiumName);
                if (compendium == null || compendium == undefined) {
                    console.log('NPCImporter | Could not find compendium with the name ' + compendiumName);
                } else {
                    let npcName = this.getAttribute(npcData.attribs, 'npc_name');
                    console.log("NPCImporter | Creating npc named " + npcName);
                    let npc = Actor5e.create({ name: npcName, type: 'npc' }, { temporary: true, displaySheet: false }).then(async actor => {
                        await this.parseNpcData(actor, npcData, true);
                        console.log("NPCImporter | Importing into the compendium");
                        compendium.importEntity(actor);
                        //actor.delete();
                    });
                }
            } else {
                console.log('NPCImporter | No compendium name was given');
            }
        } else {
            let npcName = this.getAttribute(npcData.attribs, 'npc_name');
            console.log("NPCImporter | creating npc named " + npcName);
            Actor5e.create({ name: npcName, type: 'npc' }, { temporary: false, displaySheet:false }).then(async actor => {
                actor.render(false);
                await this.parseNpcData(actor, npcData, false);
            });
        }
    }

    async parseNpcData(actor, npcData, tempActor) {
        console.log("NPCImporter | Parsing data");
        let actorData = {};

        // prepare repeating items
        let actorItems = [];
        // - collect all data of type 'repeated'
        let spells = {};
        let attacks = {};
        let feats = {};
        let legendarys = {};
        let reactions = {};
        let lair = {};
        let regional = {};


        npcData.attribs.forEach(entry => {
            if (entry.name.indexOf('repeating') != -1) {
                let splitEntry = entry.name.split('_')
                let entryType = splitEntry[1]
                let entryId = splitEntry[2];
                let entryName = '';
                for (let i = 3; i < splitEntry.length; i++) {
                    entryName += splitEntry[i];
                }
                let entryNameMax = entryName + 'Max';
                switch (entryType) {
                    case 'npctrait':
                    case 'trait':
                        this.addEntryToItemTable(feats, entryId, entryName, entry.current);
                        break;
                    case 'npcaction':
                    case 'action':
                        this.addEntryToItemTable(attacks, entryId, entryName, entry.current);
                        break;
                    case 'spell-npc':
                    case 'spell-cantrip':
                    case 'spell-1':
                    case 'spell-2':
                    case 'spell-3':
                    case 'spell-4':
                    case 'spell-5':
                    case 'spell-6':
                    case 'spell-7':
                    case 'spell-8':
                    case 'spell-9':
                    case 'spell0':
                    case 'spell1':
                    case 'spell2':
                    case 'spell3':
                    case 'spell4':
                    case 'spell5':
                    case 'spell6':
                    case 'spell7':
                    case 'spell8':
                    case 'spell9':
                        spells = this.addEntryToItemTable(spells, entryId, entryName, entry.current);
                        break;
                    case 'npcreaction':
                    case 'reaction':
                        this.addEntryToItemTable(reactions, entryId, entryName, entry.current);
                        break;
                    case 'npcaction-l':
                    case 'legendaryaction':
                        this.addEntryToItemTable(legendarys, entryId, entryName, entry.current);
                        break;
                    case 'lairaction':
                        this.addEntryToItemTable(lair, entryId, entryName, entry.current);
                        break;
                    case 'regionaleffect':
                        this.addEntryToItemTable(regional, entryId, entryName, entry.current);
                        break;
                }
                if (typeof (entry.current) == 'string' && entry.current.indexOf('Legendary Resistance (') >= 0) {
                    actorData['data.resources.legres.value'] = entry.current.match(/\d+/);
                    actorData['data.resources.legres.max'] = entry.current.match(/\d+/);
                }
            }
        });

        for (let legendaryId in legendarys) {
            legendarys[legendaryId].name = this.legendaryPrefix + legendarys[legendaryId].name;
            if (this.legendaryAsAttacks) {
                attacks[legendaryId] = legendarys[legendaryId];
            } else {
                feats[legendaryId] = legendarys[legendaryId];
            }
        }

        for (let reactionId in reactions) {
            reactions[reactionId].name = this.reactionPrefix + reactions[reactionId].name;
            if (this.reactionsAsAttacks) {
                attacks[reactionId] = reactions[reactionId];
            } else {
                feats[reactionId] = reactions[reactionId];
            }
        }
        let lairNum = 0;
        for (let lairId in lair) {
            if (lair[lairId][this.translateAttribName('name')] == undefined) {
                lair[lairId][this.translateAttribName('name')] = this.lairPrefix + ' '+ ++lairNum;
            } else {
                lair[lairId][this.translateAttribName('name')] = this.lairPrefix + ' - ' + lair[lairId][this.translateAttribName('name')];
            }
            if (this.lairAsAttacks) {
                attacks[lairId] = lair[lairId];
            } else {
                feats[lairId] = lair[lairId];
            }
        }
        let regNum = 0;
        for (let regionalId in regional) {
            if (regional[regionalId][this.translateAttribName('name')] == undefined) {
                regional[regionalId][this.translateAttribName('name')] = this.regionalPrefix + ' ' + ++regNum;
            } else {
                regional[regionalId][this.translateAttribName('name')] = this.regionalPrefix + ' - ' + regional[regionalId][this.translateAttribName('name')];
            }
            if (this.regionalAsAttacks) {
                attacks[regionalId] = regional[regionalId];
            } else {
                feats[regionalId] = regional[regionalId];
            }
        }

        // set details
        actorData['name'] = this.getAttribute(npcData.attribs, 'npc_name');
        if (actorData['name'] == false) {
            actorData['name'] = npcData.name;
        }
        actorData['img'] = npcData.avatar;
        if (actorData['img'].indexOf('?') != -1) {
            actorData['img'] = actorData['img'].split('?')[0];
        }
        actorData['data.details.cr.value'] = parseInt(this.getAttribute(npcData.attribs, 'npc_challenge')); // parsing has to be done here since the value is needed for calculations
        
        if (this.isOgl) {
            let npcType = this.cleanTypeString(this.getAttribute(npcData.attribs, 'npc_type'));
            actorData['data.details.type.value'] = this.fixUpperCase(npcType.type);
            actorData['data.details.alignment.value'] = this.fixUpperCase(npcType.alignment);
            actorData['data.details.source.value'] = this.defaultSource;
            actorData['data.traits.size.value'] = this.fixUpperCase(npcType.size)
        } else {
            actorData['data.details.type.value'] = this.fixUpperCase(this.getAttribute(npcData.attribs, 'type'));
            actorData['data.details.alignment.value'] = this.fixUpperCase(this.getAttribute(npcData.attribs, 'alignment'));
            actorData['data.details.source.value'] = this.defaultSource;
            actorData['data.traits.size.value'] = this.fixUpperCase(this.getAttribute(npcData.attribs, 'size'));
        }

        let bio = npcData.bio;
        if (npcData.gmnotes != '') {
            bio = bio + '\n<p><strong>GM Notes:</strong></p>\n<p>' + npcData.gmnotes + '</p>';
        }
        actorData['data.details.biography.value'] = bio;



        // set attributes
        actorData['data.attributes.ac.value'] = this.getAttribute(npcData.attribs, 'npc_ac');
        actorData['data.attributes.hp.formula'] = this.getAttribute(npcData.attribs, 'npc_hpformula') == false ? this.defaultHealth : this.getAttribute(npcData.attribs, 'npc_hpformula');
        let hp = 10;
        if (this.getAttribute(npcData.attribs, 'hp', true) != false) {
            hp = this.getAttribute(npcData.attribs, 'hp', true);
        } else if (this.getAttribute(npcData.attribs, 'npc_hpbase') != false) {
            hp = this.getAttribute(npcData.attribs, 'npc_hpbase');
        } else {
            hp = this.setDefaultHealth(actorData['data.attributes.hp.formula']);
        }
        actorData['data.attributes.hp.value'] = hp;
        actorData['data.attributes.hp.max'] = hp;
        actorData['data.attributes.init.mod'] = this.getAttribute(npcData.attribs, 'initiative_bonus');
        actorData['data.attributes.prof.value'] = Math.floor((7 + actorData['data.details.cr.value']) /4);
        actorData['data.attributes.speed.value'] = this.getAttribute(npcData.attribs, 'npc_speed');
        let spellcastingVal = this.getAttribute(npcData.attribs, 'spellcasting_ability');
        if (spellcastingVal != false) {
            actorData['data.attributes.spellcasting.value'] = this.getShortformAbility(spellcastingVal);
        }
        actorData['data.attributes.spelldc.value'] = this.getAttribute(npcData.attribs, 'npc_spelldc');

        // set abilities
        let abilityValue = {};

        actorData['data.abilities.str.value'] = this.getAttribute(npcData.attribs, 'strength');
        if (actorData['data.abilities.str.value'] == false) {
            actorData['data.abilities.str.value'] = this.getAttribute(npcData.attribs, 'npcd_str');
        }

        actorData['data.abilities.dex.value'] = this.getAttribute(npcData.attribs, 'dexterity');
        if (actorData['data.abilities.dex.value'] == false) {
            actorData['data.abilities.dex.value'] = this.getAttribute(npcData.attribs, 'npcd_dex');
        }

        actorData['data.abilities.con.value'] = this.getAttribute(npcData.attribs, 'constitution');
        if (actorData['data.abilities.con.value'] == false) {
            actorData['data.abilities.con.value'] = this.getAttribute(npcData.attribs, 'npcd_con');
        }

        actorData['data.abilities.int.value'] = this.getAttribute(npcData.attribs, 'intelligence');
        if (actorData['data.abilities.int.value'] == false) {
            actorData['data.abilities.int.value'] = this.getAttribute(npcData.attribs, 'npcd_int');
        }

        actorData['data.abilities.wis.value'] = this.getAttribute(npcData.attribs, 'wisdom');
        if (actorData['data.abilities.wis.value'] == false) {
            actorData['data.abilities.wis.value'] = this.getAttribute(npcData.attribs, 'npcd_wis');
        }

        actorData['data.abilities.cha.value'] = this.getAttribute(npcData.attribs, 'charisma');
        if (actorData['data.abilities.cha.value'] == false) {
            actorData['data.abilities.cha.value'] = this.getAttribute(npcData.attribs, 'npcd_cha');
        }

        // set saving throws
        if (this.getAttribute(npcData.attribs, 'npc_str_save_flag') != '0')
            actorData['data.abilities.str.proficient'] = 1;
        if (this.getAttribute(npcData.attribs, 'npc_dex_save_flag') != '0')
            actorData['data.abilities.dex.proficient'] = 1;
        if (this.getAttribute(npcData.attribs, 'npc_con_save_flag') != '0')
            actorData['data.abilities.con.proficient'] = 1;
        if (this.getAttribute(npcData.attribs, 'npc_int_save_flag') != '0')
            actorData['data.abilities.int.proficient'] = 1;
        if (this.getAttribute(npcData.attribs, 'npc_wis_save_flag') != '0')
            actorData['data.abilities.wis.proficient'] = 1;
        if (this.getAttribute(npcData.attribs, 'npc_int_save_flag') != '0')
            actorData['data.abilities.cha.proficient'] = 1;

        // set proficiencies
        if (this.getAttribute(npcData.attribs, 'npc_acrobatics_flag') != 0)
            actorData['data.skills.acr.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_acrobatics'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.dex.value']);
        if (this.getAttribute(npcData.attribs, 'npc_animal_handling_flag') != 0)
            actorData['data.skills.ani.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_animal_handling'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.wis.value']);
        if (this.getAttribute(npcData.attribs, 'npc_arcana_flag') != 0)
            actorData['data.skills.arc.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_arcana'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.int.value']);
        if (this.getAttribute(npcData.attribs, 'npc_athletics_flag') != 0)
            actorData['data.skills.ath.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_athletics'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.dex.value']);
        if (this.getAttribute(npcData.attribs, 'npc_deception_flag') != 0)
            actorData['data.skills.dec.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_deception'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.cha.value']);
        if (this.getAttribute(npcData.attribs, 'npc_history_flag') != 0)
            actorData['data.skills.his.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_history'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.int.value']);
        if (this.getAttribute(npcData.attribs, 'npc_insight_flag') != 0)
            actorData['data.skills.ins.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_insight'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.wis.value']);
        if (this.getAttribute(npcData.attribs, 'npc_intimidation_flag') != 0)
            actorData['data.skills.itm.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_intimidation'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.cha.value']);
        if (this.getAttribute(npcData.attribs, 'npc_investigation_flag') != 0)
            actorData['data.skills.inv.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_investigation'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.int.value']);
        if (this.getAttribute(npcData.attribs, 'npc_medicine_flag') != 0)
            actorData['data.skills.med.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_medicine'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.wis.value']);
        if (this.getAttribute(npcData.attribs, 'npc_nature_flag') != 0)
            actorData['data.skills.nat.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_nature'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.int.value']);
        if (this.getAttribute(npcData.attribs, 'npc_perception_flag') != 0)
            actorData['data.skills.prc.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_perception'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.wis.value']);
        if (this.getAttribute(npcData.attribs, 'npc_performance_flag') != 0)
            actorData['data.skills.prf.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_performance'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.cha.value']);
        if (this.getAttribute(npcData.attribs, 'npc_persuasion_flag') != 0)
            actorData['data.skills.per.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_persuasion'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.cha.value']);
        if (this.getAttribute(npcData.attribs, 'npc_religion_flag') != 0)
            actorData['data.skills.rel.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_religion'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.int.value']);
        if (this.getAttribute(npcData.attribs, 'npc_sleight_of_hand_flag') != 0)
            actorData['data.skills.slt.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_sleight_of_hand'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.dex.value']);
        if (this.getAttribute(npcData.attribs, 'npc_stealth_flag') != 0)
            actorData['data.skills.ste.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_stealth'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.dex.value']);
        if (this.getAttribute(npcData.attribs, 'npc_survival_flag') != 0)
            actorData['data.skills.sur.value'] = this.getSkillProficiencyMultiplyer(
                this.getAttribute(npcData.attribs, 'npc_survival'),
                actorData['data.attributes.prof.value'],
                actorData['data.abilities.wis.value']);


        // set traits
        actorData['data.traits.senses.value'] = this.getAttribute(npcData.attribs, 'npc_senses');

        let passivePerception = 10 + Math.floor((actorData['data.abilities.wis.value'] - 10) / 2);
        if (actorData['data.skills.prc.value'] != undefined) {
            passivePerception = passivePerception + (actorData['data.attributes.prof.value'] * actorData['data.skills.prc.value']);
        }
        actorData['data.traits.perception.value'] = passivePerception;
        actorData['data.traits.languages.value'] = this.getAttribute(npcData.attribs, 'npc_languages');
        actorData['data.traits.di.value'] = this.getAttribute(npcData.attribs, 'npc_immunities');
        actorData['data.traits.dr.value'] = this.getAttribute(npcData.attribs, 'npc_resistances');
        actorData['data.traits.dv.value'] = this.getAttribute(npcData.attribs, 'npc_vulnerabilities');
        actorData['data.traits.ci.value'] = this.getAttribute(npcData.attribs, 'npc_condition_immunities');

        if (actorData['data.traits.perception.value'] == false) actorData['data.traits.perception.value'] = '';
        if (actorData['data.traits.languages.value'] == false) actorData['data.traits.languages.value'] = '';
        if (actorData['data.traits.di.value'] == false) actorData['data.traits.di.value'] = '';
        if (actorData['data.traits.dr.value'] == false) actorData['data.traits.dr.value'] = '';
        if (actorData['data.traits.dv.value'] == false) actorData['data.traits.dv.value'] = '';
        if (actorData['data.traits.ci.value'] == false) actorData['data.traits.ci.value'] = '';

        // set spellslots
        actorData['data.spells.spell1.value'] = this.getAttribute(npcData.attribs, 'lvl1_slots_total');
        actorData['data.spells.spell1.max'] = actorData['data.spells.spell1.value'];
        actorData['data.spells.spell2.value'] = this.getAttribute(npcData.attribs, 'lvl2_slots_total');
        actorData['data.spells.spell2.max'] = actorData['data.spells.spell2.value'];
        actorData['data.spells.spell3.value'] = this.getAttribute(npcData.attribs, 'lvl3_slots_total');
        actorData['data.spells.spell3.max'] = actorData['data.spells.spell3.value'];
        actorData['data.spells.spell4.value'] = this.getAttribute(npcData.attribs, 'lvl4_slots_total');
        actorData['data.spells.spell4.max'] = actorData['data.spells.spell4.value'];
        actorData['data.spells.spell5.value'] = this.getAttribute(npcData.attribs, 'lvl5_slots_total');
        actorData['data.spells.spell5.max'] = actorData['data.spells.spell5.value'];
        actorData['data.spells.spell6.value'] = this.getAttribute(npcData.attribs, 'lvl6_slots_total');
        actorData['data.spells.spell6.max'] = actorData['data.spells.spell6.value'];
        actorData['data.spells.spell7.value'] = this.getAttribute(npcData.attribs, 'lvl7_slots_total');
        actorData['data.spells.spell7.max'] = actorData['data.spells.spell7.value'];
        actorData['data.spells.spell8.value'] = this.getAttribute(npcData.attribs, 'lvl8_slots_total');
        actorData['data.spells.spell8.max'] = actorData['data.spells.spell8.value'];
        actorData['data.spells.spell9.value'] = this.getAttribute(npcData.attribs, 'lvl9_slots_total');
        actorData['data.spells.spell9.max'] = actorData['data.spells.spell9.value'];

        // ressources 
        let legActions = this.getAttribute(npcData.attribs, 'npc_legendary_actions');
        if (legActions == false) {
            legActions = this.getAttribute(npcData.attribs, 'legendary_flag');
        }
        if (legActions == false) {
            legActions = 0;
        }
            
        actorData['data.resources.legact.value'] = legActions;
        actorData['data.resources.legact.max'] = legActions;

        // create and save items
        let customSpellNames = {};

        if (Object.keys(spells).length > 0) {
            for (let spellId in spells) {
                if (spells[spellId][this.translateAttribName('spellName')] == 'CANTRIPS' || spells[spellId][this.translateAttribName('spellName')].indexOf('LEVEL') != -1)
                    continue;
                let spellName = spells[spellId][this.translateAttribName('spellName')];
                if (this.spellCompendium !== null) {
                    let spell;
                    await this.spellCompendium.getIndex().then(async index => {
                        
                        spell = index.find(e => e.name.toLowerCase() === spellName.toLowerCase() );
                    });
                    if (spell != null && spell != undefined) {
                        console.log('NPCImporter| Found Spell ' + spells[spellId].spellname + ' in compendium, using that');
                        spell = await this.spellCompendium.getEntry(spell['id']);
                        actorItems.push(spell);
                        continue;
                    }
                }
                let ability = spells[spellId][this.translateAttribName('savingthrowability')] == undefined ? '' : this.getShortformAbility(spells[spellId][this.translateAttribName('savingthrowability')]);
                let components = '';
                let concentration = spells[spellId][this.translateAttribName('spellconcentration')] != null ? true : false;
                let description = spells[spellId][this.translateAttribName('spelldescription')] != undefined ? spells[spellId][this.translateAttribName('spelldescription')] : spells[spellId][this.translateAttribName('spellcontent')];
                if (description != undefined && description != false) description = '<p>' + description.replace('\n\n', '</p>\n<p>')+'</p>';
                if (spells[spellId][this.translateAttribName('spellathigherlevels')] != undefined) description = description + '\n Cast at higher level:' + spells[spellId][this.translateAttribName('spellathigherlevels')];
                let duration = spells[spellId][this.translateAttribName('spellduration')] == undefined ? '' : spells[spellId][this.translateAttribName('spellduration')];
                let level = spells[spellId][this.translateAttribName('spelllevel')] == 'cantrip' ? 0 : spells[spellId][this.translateAttribName('spelllevel')];
                if (this.isOgl == false && level != undefined) level = level.charAt(0);
                if (level == 'C' || level == '' || level == undefined) level = 0;
                let materials = spells[spellId][this.translateAttribName('spellcompmaterials')] == undefined ? '' : spells[spellId][this.translateAttribName('spellcompmaterials')];
                let range = spells[spellId][this.translateAttribName('spellrange')] == undefined ? '' : spells[spellId][this.translateAttribName('spellrange')];
                let school = 'abj';
                if (spells[spellId][this.translateAttribName('spellschool')] != undefined && spells[spellId][this.translateAttribName('spellschool')].length > 0)
                    school = this.getShortformSchool(spells[spellId][this.translateAttribName('spellschool')]);
                let spelltype = 'utility';
                
                let target = spells[spellId][this.translateAttribName('spelltarget')] == undefined ? '' : spells[spellId][this.translateAttribName('spelltarget')] + '';
                let time = spells[spellId][this.translateAttribName('spellcastingtime')] == undefined ? '' : spells[spellId][this.translateAttribName('spellcastingtime')] + '';

                let save = spells[spellId][this.translateAttribName('spellsave')] != null ? this.getShortformAbility(spells[spellId][this.translateAttribName('spellsave')]) : '';
                let ritual = spells[spellId][this.translateAttribName('spellritual')] != null ? true : false;
                let damage = spells[spellId][this.translateAttribName('spelldamage')] == undefined ? '' : spells[spellId][this.translateAttribName('spelldamage')];
                let damageType = spells[spellId][this.translateAttribName('spelldamagetype')] == undefined ? '' : spells[spellId][this.translateAttribName('spelldamagetype')].toLowerCase();
                
                if (save != '') {
                    spelltype = 'save';
                } else if (spells[spellId][this.translateAttribName('spellattack')] != undefined) {
                    spelltype = 'attack';
                }

                if (this.isOgl == false) {
                    if (spells[spellId][this.translateAttribName('spelloutput')] == 'ATTACK') {
                        // saving throw dmg
                        let dmg;
                        let type;
                        if (spells[spellId][this.translateAttribName('attackability')] != undefined) {
                            spelltype = 'attack';
                            dmg = spells[spellId][this.translateAttribName('attackdamagedice')];
                            if (Number.isInteger(dmg) == false) {
                                dmg = 1;
                            }
                            dmg = dmg + spells[spellId][this.translateAttribName('attackdamagedie')];
                            type = spells[spellId][this.translateAttribName('attackdamagetype')];
                        } else {
                            spelltype = 'save';
                            dmg = spells[spellId][this.translateAttribName('savingthrowdamagedice')];
                            if (Number.isInteger(dmg) == false) {
                                dmg = 1;
                            }
                            dmg = dmg + spells[spellId][this.translateAttribName('savingthrowdamagedie')];
                            type = spells[spellId][this.translateAttribName('savingthrowdamagetype')];
                        }
                        damage = dmg;
                        damageType = type;
                    }

                    spellName = this.fixUpperCase(spellName);
                    time = this.fixUpperCase(time.replace('_', ' ').toLowerCase());
                    duration = this.fixUpperCase(duration.replace(/_/g, ' ').toLowerCase());
                    let newComponents = '';
                    for (let i = 1; i < components.split('_').length; i++) {
                        newComponents += components.split('_')[i];
                        if (i < (components.split('_').length - 1)) {
                            newComponents += ' ';
                        }
                    }
                    components = newComponents;
                } else {
                    components = '';
                    if (spells[spellId][this.translateAttribName('spellcompv')] != '0') {
                        components = components + 'V ';
                    }
                    if (spells[spellId][this.translateAttribName('spellcomps')] != '0') {
                        components = components + 'S ';
                    }
                    if (spells[spellId][this.translateAttribName('spellcompm')] != '0') {
                        components = components + 'M';
                    }
                }

                let spellObject = {
                    name: spellName,
                    type: "spell",
                    img: 'icons/mystery-man.png',
                    data: {
                        ability: { type: "String", label: "Spellcasting Ability", value: ability },
                        components: { type: "String", label: "Spell Components", value: components },
                        concentration: { type: "Boolean", label: "Requires Concentration", value: concentration },
                        damage: { type: "String", label: "Spell Damage", value: damage },
                        damageType: { type: "String", label: "Damage Type", value: damageType },
                        description: { type: "String", label: "Description", value: description },
                        duration: { type: "String", label: "Duration", value: duration },
                        level: { type: "Number", label: "Spell Level", value: level },
                        materials: { type: "String", label: "Materials", value: materials },
                        range: { type: "String", label: "Range", value: range },
                        ritual: { type: "Boolean", label: "Cast as Ritual", value: ritual },
                        save: { type: "String", label: "Saving Throw", value: save },
                        school: { type: "String", label: "Spell School", value: school },
                        source: { type: "String", label: "Source", value: 'Roll20 NPC Importer' },
                        spellType: { type: "String", label: "Spell Type", value: spelltype },
                        target: { type: "String", label: "Target", value: target },
                        time: { type: "String", label: "Casting Time", value: time }
                    }
                };
                actorItems.push(spellObject);
            }
        }

        if (Object.keys(attacks).length > 0) {
            for (let attackId in attacks) {
                let strMod = Math.floor(actorData['data.abilities.str.value'] / 2 - 5);

                let name = attacks[attackId][this.translateAttribName('attName')] != undefined ? attacks[attackId][this.translateAttribName('attName')] : attacks[attackId][this.translateAttribName('attNameAlt')];
                let description = attacks[attackId][this.translateAttribName('attDesc')] == undefined ? attacks[attackId][this.translateAttribName('attDecAlt')] : attacks[attackId][this.translateAttribName('attDesc')];
                if(description != undefined && description != false) description = '<p>' + description.replace('\n\n', '</p>\n<p>') + '</p>';
                let bonus = attacks[attackId][this.translateAttribName('attacktohit')] == undefined ? '' : (attacks[attackId][this.translateAttribName('attacktohit')] - actorData['data.attributes.prof.value'] - strMod);
                let damage = attacks[attackId].attackdamage == undefined ? '' : attacks[attackId].attackdamage + '-' + strMod;
                let damageType = attacks[attackId].attackdamagetype == undefined ? '' : attacks[attackId].attackdamagetype.toLowerCase();
                let damage2 = attacks[attackId].attackdamage2 == undefined ? '' : attacks[attackId].attackdamage2 + '-' + strMod;
                let damage2Type = attacks[attackId][this.translateAttribName('attackdamagetype2')] == undefined ? '' : attacks[attackId].attackdamagetype2.toLowerCase();
                let range = attacks[attackId][this.translateAttribName('attackrange')] == undefined ? '' : attacks[attackId][this.translateAttribName('attackrange')];
                let ability = '';
                if (this.isOgl == false) {
                    bonus = attacks[attackId][this.translateAttribName('attacktohit')]; // TODO: discern how hitbonus is stored
                    ability = attacks[attackId][this.translateAttribName('attackability')];

                    let dmg = attacks[attackId][this.translateAttribName('attackdamagedice')];
                    if (Number.isInteger(dmg) == false) {
                        dmg = 1;
                    }
                    damage = dmg + attacks[attackId][this.translateAttribName('attackdamagedie')];

                    dmg = attacks[attackId][this.translateAttribName('attack2damagedice')];
                    if (Number.isInteger(dmg) == false) {
                        dmg = 1;
                    }
                    damage2 = dmg + attacks[attackId][this.translateAttribName('attack2damagedie')];
                }

                let attackObject = {
                    img: "icons/mystery-man.png",
                    name: name,
                    type: "weapon",
                    data: {
                        ability: { type: "String", label: "Offensive Ability", value: '' },
                        attuned: { type: "Boolean", label: "Attuned", value: false },
                        bonus: { type: "String", label: "Weapon Bonus", value: bonus },
                        damage: { type: "String", label: "Damage Formula", value: damage },
                        damageType: { type: "String", label: "Damage Type", value: damageType },
                        damage2: { type: "String", label: "Alternate Damage", value: damage2 },
                        damage2Type: { type: "String", label: "Alternate Type", value: damage2Type },
                        description: { type: "String", label: "Description", value: description },
                        price: { type: "String", label: "Price", value: '' },
                        proficient: { type: "Boolean", label: "Proficient", value: true },
                        properties: { type: "String", label: "Weapon Properties", value: '' },
                        quantity: { type: "Number", label: "Quantity", value: 1 },
                        range: { type: "String", label: "Weapon Range", value: range },
                        source: { type: "String", label: "Source", value: 'Roll20 NPC Importer' },
                        weaponType: { type: "String", label: "Weapon Type", value: '' },
                        weight: { type: "Number", label: "Weight", value: 0 },
                        ability: { type: "String", label: "Offensive Ability", value: ability }
                    }
                };
                actorItems.push(attackObject);
            }
        }
        if (Object.keys(feats).length > 0) {
            for (let featId in feats) {
                let name = feats[featId][this.translateAttribName('attName')] != undefined ? feats[featId][this.translateAttribName('attName')] : feats[featId][this.translateAttribName('attNameAlt')];
                let description = feats[featId][this.translateAttribName('attDesc')] == undefined ? feats[featId][this.translateAttribName('attDecAlt')] : feats[featId][this.translateAttribName('attDesc')];
                if (description != undefined && description != false) description = '<p>' + description.replace('\n\n', '</p>\n<p>') + '</p>';
                let damage = feats[featId][this.translateAttribName('attackdamage')] == undefined ? '' : feats[featId][this.translateAttribName('attackdamage')] + '-' + strMod;
                let damageType = feats[featId][this.translateAttribName('featdmgtype')] == undefined ? '' : feats[featId][this.translateAttribName('featdmgtype')].toLowerCase();
                let range = feats[featId][this.translateAttribName('attackrange')] == undefined ? '' : feats[featId][this.translateAttribName('attackrange')];
                let save = '';
                let ability = '';
                let featType = 'passive';
                if (this.isOgl == false) {
                    //bonus = feats[featId][this.translateAttribName('attacktohit')]; // TODO: discern how hitbonus is stored
                    let abilityName;
                    let diceName;
                    let dieName;
                    if (feats[featId][this.translateAttribName('healtoggle')] == 1) {
                        diceName = 'healdice';
                        dieName = 'healdie';
                        abilityName = 'healability';
                        damageType = 'healing';
                        featType = 'ability';
                    } else if (feats[featId][this.translateAttribName('savingthrowtoggle')] == 1) {
                        diceName = 'savingthrowdamagedice';
                        dieName = 'savingthrowdamagedie';
                        abilityName = 'savingthrowability';
                        damageType = 'savingthrowdamagetype';
                        featType = 'ability';
                        save = this.getShortformAbility(feats[featId][this.translateAttribName('savingthrowvsability')]);
                    } else if (feats[featId][this.translateAttribName('otherdamagetoggle')] == 1) {
                        diceName = 'featdamagedice';
                        dieName = 'featdamagedie';
                        abilityName = 'featAbility';
                        damageType = 'otherdamagetype';
                        featType = 'attack';
                    }
                    if (feats[featId][this.translateAttribName(diceName)] != undefined) {
                        let dmg = feats[featId][this.translateAttribName(diceName)];
                        if (Number.isInteger(dmg) == false) {
                            dmg = 1;
                        }
                        damage = dmg + feats[featId][this.translateAttribName(dieName)];
                    }
                    if (feats[featId][this.translateAttribName(abilityName)] != undefined) {
                        ability = feats[featId][this.translateAttribName(abilityName)];
                    }
                    damageType = feats[featId][this.translateAttribName(damageType)] == undefined ? '' : feats[featId][this.translateAttribName(damageType)].toLowerCase();

                }
                
                // reading spellslot details from spellcasting feature as a fallback
                if (name == 'Spellcasting' && this.isOgl) {
                    // looking for spellslot information
                    for (let i = 1; i < 10; i++) {
                        let regex;
                        switch (i) {
                            case 1: regex = new RegExp("(" + i + "st level \\()(\\d*)", 'gm'); break;
                            case 2: regex = new RegExp("(" + i + "nd level \\()(\\d*)", 'gm'); break;
                            case 3: regex = new RegExp("(" + i + "rd level \\()(\\d*)", 'gm'); break;
                            default: regex = new RegExp("(" + i + "th level \\()(\\d*)", 'gm'); break;
                        }
                        let match = regex.exec(description);
                        if (match != undefined && match.length >= 2 && match[2] != 0) {
                            let spellSlotCount = match[2];
                            if (actorData['data.spells.spell' + i + '.value'] != spellSlotCount) {
                                actorData['data.spells.spell' + i + '.value'] = spellSlotCount;
                                actorData['data.spells.spell' + i + '.max'] = spellSlotCount;
                            }
                        }                       
                    }

                    // at will spells
                    customSpellNames = this.findAtWillSpells(customSpellNames, description);

                    // x per day spells
                    customSpellNames = this.findPerDaySpells(customSpellNames, description);                    
                }

                let featObject = {
                    name: name,
                    type: 'feat',
                    data: {
                        damage: { type: "String", label: "Ability Damage", value: damage },
                        damageType: { type: "String", label: "Damage Type", value: damageType },
                        description: { type: "String", label: "Description", value: description},
                        duration: { type: "String", label: "Duration", value: '' },
                        featType: { type: "String", label: "Feat Type", value: featType },
                        range: { type: "String", label: "Range", value: range },
                        requirements: { type: "String", label: "Requirements", value: '' },
                        save: { type: "String", label: "Saving Throw", value: save },
                        source: { type: "String", label: "Source", value: 'Roll20 NPC Importer'  },
                        target: { type: "String", label: "Target", value: '' },
                        time: { type: "String", label: "Casting Time", value: '' },
                        ability: { type: "String", label: "Offensive Ability", value: ability }
                    }
                }

                actorItems.push(featObject);
            }
        }

        if (this.isOgl == false) {
            // at will spells
            customSpellNames = this.findAtWillSpells(customSpellNames, this.getAttribute(npcData.attribs, 'innate_spellcasting_blurb'));

            // x per day spells
            customSpellNames = this.findPerDaySpells(customSpellNames, this.getAttribute(npcData.attribs, 'innate_spellcasting_blurb'));  
        }

        // apply custom spell tags (such as "at will" or "x/day")
        for (let oldName in customSpellNames) {
            for (let i in actorItems) {
                let itemName = actorItems[i].name.toLowerCase();
                if (itemName == oldName) {
                    actorItems[i].name = this.fixUpperCase(customSpellNames[oldName]);
                }
            }
        }

        // set token
        try {
            let npcTokenData = JSON.parse(npcData.defaulttoken.replace('\\', ''));
            actorData['token.displayName'] = parseInt(this.showTokenName); 
            actorData['token.name'] = actorData['name'];
            actorData['token.img'] = npcTokenData['imgsrc'];
            if (actorData['token.img'].indexOf('?') != -1) {
                actorData['token.img'] = actorData['token.img'].split('?')[0];
            }
            if (this.useTokenAsAvatar) {
                actorData['img'] = actorData['token.img'];
            }
            actorData['token.width'] = this.getTokenSize(actorData['data.traits.size.value']);
            actorData['token.height'] = actorData['token.width'];

            if (npcTokenData['light_hassight'] == true && this.ignoreTokenLight == false) {
                actorData['token.dimSight'] = parseInt(npcTokenData['light_radius']);
                actorData['token.brightSight'] = parseInt(npcTokenData['light_dimradius']);
            }
            if (npcTokenData['light_otherplayers'] == true && this.ignoreTokenLight == false) {
                actorData['token.dimLight'] = parseInt(npcTokenData['light_radius']);
                actorData['token.brightLight'] = parseInt(npcTokenData['light_dimradius']);
            }

            actorData['token.displayBars'] = parseInt(this.showTokenBars);
            if (this.tokenBar1Link == 'attributes.hp') {
                actorData['token.bar1.value'] = actorData['data.attributes.hp.value'];
                actorData['token.bar1.max'] = actorData['data.attributes.hp.max'];
            } else {
                actorData['token.bar1.value'] = npcTokenData['bar1_value'];
                actorData['token.bar1.max'] = npcTokenData['bar1_max'];     
            }    
            actorData['token.bar2.value'] = npcTokenData['bar2_value'];
            actorData['token.bar2.max'] = npcTokenData['bar2_max'];
            actorData['token.bar1.attribute'] = this.tokenBar1Link;
            actorData['token.bar2.attribute'] = this.tokenBar2Link;   


        } catch (e) {
            console.error("Could not parse defaulttoken data, token not loaded");
            console.error(e.message);
        }
        
        

        // save data to actor
        await this.createActorItems(actor, actorItems, tempActor);
        actor.update(actorData);

    }

    /**
     * returns either the current or max value of the first attribute with the name specified
     * @param {Array} data - the array containing the attributes
     * @param {String} name - the name of the searched attribute
     * @param {boolean} getMaxValue - optional param, required if the max value is requested
     */
    getAttribute(data, name, getMaxValue = false) {
        let result = null;
        name = this.translateAttribName(name);
        data.forEach(function (item, index) {
            if (item.name == name) {
                if (getMaxValue == true) {
                    result = item.max;
                } else {
                    result = item.current;
                }
            }
        });
        if (result == null) {
            if (this.showMissingAttribError) {
                console.error("Could not find Value for " + name);
            }
            return false;
        }
        return result;
    }

    /**
     * splits a npctype string like "meadium Beast, unaligned" into 3 substrings containing type, size and alignement in seperate Strings
     * @param {String} npcString
     */
    cleanTypeString(npcString) {
        if (npcString != false) {
            npcString = npcString.toLowerCase();
            let cleanString = {
                type: '',
                size: this.getSize(npcString),
                alignment: this.getAlignment(npcString)
            }

            cleanString.type = this.fixUpperCase(npcString.replace(cleanString.size, '').replace(cleanString.alignment, '')).trim().replace(',', '');
            return cleanString;
        } else {
            return { type: '', size: '', alignment: '' };
        }
    }


    /**
     * Cleans the type string of npcs, removing alignment and size, not yet fully implemented
     * @param {String} npcTypeString
     */
    getType(npcTypeString) {
        let cleanString = "";
        // TODO: remove size
        // TODO: improve alignment logic
        cleanString = npcTypeString.split(',')[0];
        return cleanString;
    }

    /**
     * extracts the alignment from the type string
     * @param {String} npcTypeString
     */
    getAlignment(npcTypeString) {
        let cleanString = "";
        npcTypeString = npcTypeString.toLowerCase();
        let alignments = [
            'lawful',
            'chaotic',
            'good',
            'evil',
            'neutral',
            'unaligned',
            'any alignment'
        ]
        alignments.forEach(function (item) {
            if (npcTypeString.includes(item)) {
                cleanString = (cleanString.length > 0) ? cleanString + ' ' + item : item;
            }
        });
        return cleanString;
    }

    /**
     * extracts the creature size from the type string
     * @param {String} npcTypeString
     */
    getSize(npcTypeString) {
        let returnSize = "medium";
        //npcTypeString = npcTypeString.toLowerCase();
        let sizes = [
            'fine', 
            'diminutive',
            'tiny',
            'small',
            'medium',
            'large',
            'huge',
            'gargantuan',
            'colossal'
        ]

        for(let size of sizes) {
            if (npcTypeString.indexOf(size) != -1) {
                returnSize = size;
                break;
            }
        }
        return returnSize;
    }

    /**
     * returns the first found ability shortform string from the given string. case insensitive
     * @param {String} ability - the string containing the ability
     */
    getShortformAbility(ability) {
        let cleanString = '';
        let mods = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        try {
            for (let item of mods) {
                if (ability.toLowerCase().indexOf(item) != -1) {
                    cleanString = item;
                    break;
                }
            }
            return cleanString;
        } catch (e) {
            console.log('Error in getting shortform of "' + ability + '"');
            console.log(e.message);
        }
    }

    /**
     * returns the first found shortform of spellschools (first 3 letters except trs for transmutation) string from the given string. case insensitive
     * @param {String} school - the string containing the school
     */
    getShortformSchool(school) {
        let cleanString = '';
        let schools = ['abj', 'con', 'div', 'enc', 'evo', 'ill', 'nec'];

        for (let item of schools) {
            if (school.toLowerCase().indexOf(item) != -1) {
                cleanString = item;
                break;
            }
        }
        if (cleanString == '' && school.toLowerCase().indexOf('transmutation') != -1) {
            cleanString = 'trs';
        }
        return cleanString;
    }

    /**
     * returns the token dimensions based on the size modifier. medium/1x1 being the smallest possible
     * @param {String} creatureSize
     */
    getTokenSize(creatureSize) {
        switch (creatureSize.toLowerCase()) {
            case 'large': return 2; break;
            case 'huge': return 3; break;
            case 'gargantuan': return 4; break;
            case 'colossal': return 5; break;
            default: return 1; break;
        }
    }

    /**
     * Calculates the multiplyer with which the proficiency bonus should be applied to have the required bonus.
     * @param {int} target - the final bonus the skill should have
     * @param {int} proficiency - the proficiency modifier
     * @param {int} baseAbility - base value of the ability score used, NOT the modifier
     */
    getSkillProficiencyMultiplyer(target, proficiency, baseAbility) {
        let proficiencyMultiplyer = (target - Math.floor(baseAbility / 2 - 5)) / proficiency;
        return proficiencyMultiplyer;
    }

    /**
     * appends dataentrys into the table with specified id
     * @param {Object} table
     * @param {String} id
     * @param {String} name
     * @param {String} entry
     */
    addEntryToItemTable(table, id, name, entry) {
        if (table[id] == null) {
            table[id] = {};
        }
        table[id][name] = entry;
        return table;
    }

    /**
     * creates all the items for the actor sheet, extra function to support async and await
     * @param {Object} actor - the actor object that gets the items
     * @param {Object} items - an object representing the item
     */
    async createActorItems(actor, items, tempActor) {
        let itemCount = 0;
        for (let item of items) {
            itemCount++;
            if (tempActor) {
                let tempItem = await Item.create(item, { temporary: true, displaySheet: false });
                tempItem = tempItem.data;
                tempItem["id"] = itemCount;
                actor.data.items.push(tempItem);
            } else {
                await actor.createOwnedItem(item, true);
            }
        }
    }

    /**
     * tries to roll health via the provided formula, if unsuccessfull (invalid formula for example) it'll use the defaultHealth value
     * @param {String} formula - string containing a rollable formula like '2d10+15'
     */
    setDefaultHealth(formula) {
        try {
            let dice = new Roll(formula);
            dice.roll()
            console.log('NPCImporter | Rolling for NPC health, formula: ' + formula + ', rollresult: ' + dice.total);
            return dice.total;
        } catch (e) {
            console.log('NPCImporter | Rolling for NPC health failed, formula: ' + formula + 'setting the default healt value to ' + this.defaultHealth);
            return this.defaultHealth;
        }
    }

    /**
     * Loads all files from a File Picker element and puts the ontent into the targetArray
     * @param {any} files
     * @param {Array} targetArray
     */
    async loadFiles(files, targetArray) {
        for(let file of files) {
            let fileContent = await this.readFileAsync(file);
            targetArray.push(fileContent);
        }
        return targetArray;
    }

    /**
     * Async loading of a file, returns text content
     * @param {any} file
     */
    readFileAsync(file) {
        return new Promise((resolve, reject) => {
            let reader = new FileReader();

            reader.onload = (evt) => {
                resolve(evt.target.result);
            };

            reader.onerror = reject;

            reader.readAsText(file, "UTF-8");
        });
    }

    /**
     * turns the first letter of every word into upperCase
     * @param {String} string
     */
    fixUpperCase(string) {
        if (string != undefined && string != false) {
            return string.toLowerCase().replace(/(^|\s)([a-z])/g, function (m, p1, p2) { return p1 + p2.toUpperCase(); });
        } else {
            if (string == false) {
                return '';
            } else {
                return string;
            }
        }
    }

    /**
     * returns the name of the attribute from the dictionary depending on this.isOgl
     * @param {any} name
     * @param {boolean} getShapedOverride - forces the function to return the shaped variant from the dictionary
     */
    translateAttribName(name) {
        //console.log('DEBUG name:' + name);
        //console.log('array: ' + STAT_DICTIONARY[name]);
        //console.log('isOgl: ' + this.isOgl);
        if (this.isOgl) {
            if (STAT_DICTIONARY[name] != undefined && STAT_DICTIONARY[name].length == 2) {
                //console.log('translated: ' + STAT_DICTIONARY[name][0]);
                return STAT_DICTIONARY[name][0];
            }
        } else {
            if (STAT_DICTIONARY[name] != undefined && STAT_DICTIONARY[name].length == 2) {
                //console.log('translated: ' + STAT_DICTIONARY[name][1]);
                return STAT_DICTIONARY[name][1];
            }
        }
        return name;
    }

    findAtWillSpells(customSpells, searchString) {
        let regex = new RegExp('(At will:)(.*)', 'gm');
        let match = regex.exec(searchString);
        if (match != undefined && match.length >= 2) {
            match = match[2].trim().toLowerCase();
            customSpells[match] = match + ' (at will)';
        }
        return customSpells;
    }

    findPerDaySpells(customSpells, searchString) {
        let regex = new RegExp('(\\d*)(\/day each: )(.*)', 'gm');
        let match = regex.exec(searchString);
        if (match != undefined && match.length >= 3) {
            let number = match[1];
            let spells = match[3].split(',');
            for (let spell of spells) {
                let oldName;
                let oldName2;
                let newName;
                if (spell.indexOf('(') != -1) {
                    oldName = spell.split('(')[0].trim().toLowerCase();
                    oldName2 = spell.trim(); // precaution in case the spell itself is named with the special tag
                    let specialFeature = spell.split('(')[1].trim().toLowerCase().replace(')', '');
                    newName = oldName + ' (' + number + '/day, ' + specialFeature + ')';
                } else {
                    oldName = spell.trim().toLowerCase();
                    newName = oldName + ' (' + number + '/day)';
                }
                customSpells[oldName] = newName;
                if (oldName2 != undefined) {
                    customSpells[oldName2] = newName;
                }
            }

        }
        return customSpells;
    }
}

let STAT_DICTIONARY = {    
    npc: ['npc', 'is_npc'],
    npc_challenge: ['npc_challenge', 'challenge'],
    npc_ac: ['npc_ac', 'AC'],
    npc_hpformula: ['npc_hpformula', 'hp_formula'],
    hp: ['hp', 'HP'],
    npc_speed: ['npc_speed', 'speed'],
    spellcasting_ability: ['spellcasting_ability', 'spell_ability'],
    strength: ['strength', 'strength'],
    dexterity: ['dexterity', 'dexterity'],
    constitution: ['constitution', 'constitution'],
    intelligence: ['intelligence', 'intelligence'],
    wisdom: ['wisdom', 'wisdom'],
    charisma: ['charisma', 'charisma'],
    npc_str_save_flag: ['npc_str_save_flag', 'strength_saving_throw_proficient'],
    npc_dex_save_flag: ['npc_dex_save_flag', 'dexterity_saving_throw_proficient'],
    npc_con_save_flag: ['npc_con_save_flag', 'constitution_saving_throw_proficient'],
    npc_int_save_flag: ['npc_int_save_flag', 'intelligence_saving_throw_proficient'],
    npc_wis_save_flag: ['npc_wis_save_flag', 'wisdom_saving_throw_proficient'],
    npc_cha_save_flag: ['npc_cha_save_flag', 'charisma_saving_throw_proficient'],
    // skills
    npc_acrobatics_flag: ['npc_acrobatics_flag', 'acrobatics'],
    npc_acrobatics: ['npc_acrobatics', 'acrobatics'],
    npc_animal_handling_flag: ['npc_animal_handling_flag', 'animalhandling'],
    npc_animal_handling: ['npc_animal_handling', 'animalhandling'],
    npc_arcana_flag: ['npc_arcana_flag', 'arcana'],
    npc_arcana: ['npc_arcana', 'arcana'],
    npc_athletics_flag: ['npc_athletics_flag', 'athletics'],
    npc_athletics: ['npc_athletics', 'athletics'],
    npc_deception_flag: ['npc_deception_flag', 'deception'],
    npc_deception: ['npc_deception', 'deception'],
    npc_history_flag: ['npc_history_flag', 'history'],
    npc_history: ['npc_history', 'history'],
    npc_insight_flag: ['npc_insight_flag', 'insight'],
    npc_insight: ['npc_insight', 'insight'],
    npc_intimidation_flag: ['npc_intimidation_flag', 'intimidation'],
    npc_intimidation: ['npc_intimidation', 'intimidation'],
    npc_investigation_flag: ['npc_investigation_flag', 'investigation'],
    npc_investigation: ['npc_investigation', 'investigation'],
    npc_medicine_flag: ['npc_medicine_flag', 'medicine'],
    npc_medicine: ['npc_medicine', 'medicine'],
    npc_nature_flag: ['npc_nature_flag', 'nature'],
    npc_nature: ['npc_nature', 'nature'],
    npc_perception_flag: ['npc_perception_flag', 'perception'],
    npc_perception: ['npc_perception', 'perception'],
    npc_performance_flag: ['npc_performance_flag', 'performance'],
    npc_performance: ['npc_performance', 'performance'],
    npc_persuasion_flag: ['npc_persuasion_flag', 'persuasion'],
    npc_persuasion: ['npc_persuasion', 'persuasion'],
    npc_religion_flag: ['npc_religion_flag', 'religion'],
    npc_religion: ['npc_religion', 'religion'],
    npc_sleight_of_hand_flag: ['npc_sleight_of_hand_flag', 'sleightofhand'],
    npc_sleight_of_hand: ['npc_sleight_of_hand', 'sleightofhand'],
    npc_stealth_flag: ['npc_stealth_flag', 'stealth'],
    npc_stealth: ['npc_stealth', 'stealth'],
    npc_survival_flag: ['npc_survival_flag', 'survival'],
    npc_survival: ['npc_survival', 'survival'],


    npc_senses: ['npc_senses', 'senses_string'],
    npc_languages: ['npc_languages', 'languages'],
    npc_immunities: ['npc_immunities', 'damage_immunities'],
    npc_resistances: ['npc_resistances', 'damage_resistances'],
    npc_condition_immunities: ['npc_condition_immunities', 'condition_immunities'],
    lvl1_slots_total: ['lvl1_slots_total', 'spell_level_1_slots'],
    lvl2_slots_total: ['lvl2_slots_total', 'spell_level_2_slots'],
    lvl3_slots_total: ['lvl3_slots_total', 'spell_level_3_slots'],
    lvl4_slots_total: ['lvl4_slots_total', 'spell_level_4_slots'],
    lvl5_slots_total: ['lvl5_slots_total', 'spell_level_5_slots'],
    lvl6_slots_total: ['lvl6_slots_total', 'spell_level_6_slots'],
    lvl7_slots_total: ['lvl7_slots_total', 'spell_level_7_slots'],
    lvl8_slots_total: ['lvl8_slots_total', 'spell_level_8_slots'],
    lvl9_slots_total: ['lvl9_slots_total', 'spell_level_9_slots'],
    npc_legendary_actions: ['npc_legendary_actions', 'legendary_action_amount'],
    legendary_flag: ['legendary_flag', 'legendary_action_amount'],
    // spell info spellathigherlevels
    spellName: ['spellname', 'name'],
    spellcomp: ['spellcomp', 'components'],
    spellconcentration: ['spellconcentration', 'concentration'],
    spelldamagetype: ['spelldamagetype', ''],
    spelldescription: ['spelldescription', 'content'],
    spellathigherlevels: ['spellathigherlevels', 'higherlevel'],
    spellduration: ['spellduration', 'duration'],
    spelllevel: ['spelllevel', 'spelllevel'],
    spellcompmaterials: ['spellcompmaterials', 'materials'],
    spellrange: ['spellrange', 'range'],
    spellsave: ['spellsave', 'savingthrowvsability'],
    spellschool: ['spellschool', 'school'],
    spellcastingtime: ['spellcastingtime', 'castingtime'],
    
    // attack info
    attName: ['name', 'name'],
    attNameAlt: ['namedisplay', 'name'],
    attDesc: ['description', 'content'],
    attDecAlt: ['desc', 'content'],
    attacktohit: ['attacktohit', 'attackbonus'],
    attackdamage: ['attackdamage', ''],
    attackdamagetype: ['attackdamagetype', 'attackdamagetype'],
    attackdamage2: ['attackdamage2', ''],
    attackdamagetype2: ['attackdamagetype2', 'seconddamageability'],
    attackrange: ['attackrange', 'reach'],

    // feats info
    featName: ['name', 'name'],
    featNameAlt: ['namedisplay', 'name'],
    featDesc: ['description', 'content'],
    featDecAlt: ['desc', 'content'],
}

let roll20NpcImporter = new Roll20NpcImporter();

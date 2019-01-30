/**
 * @author Felix M�ller aka syl3r86
 * @version 0.3
 */

/*
 * comp = game.packs.find(p => p.collection === "dnd5e.spells");
 * pack.importEntity(item);
 * */

class Roll20NpcImporter extends Application {

    constructor(app) {
        super(app);

        this.hookActorList();

        // setting some default options here, change to your liking. Options will be available in the app too

        this.legendaryAsAttacks = false;  // if false, legendary actions will be added to feats, true means weapons/attacks
        this.reactionsAsAttacks = false; // if false, reactions will be added to feats, true means weapons/attacks

        this.legendaryPrefix = 'LA - '; // prefix used for legendary Actions
        this.reactionPrefix = 'RE - '; // prefix used for reactions

        this.defaultHealth = 10; // default health used if all else failed

        this.showTokenName = 20; // 0=no, 1=control, 2=hover, 3=always, 20=owner hover, 40=owner
        this.showTokenBars = 40;

        this.tokenBar1Link = 'attributes.hp';
        this.tokenBar2Link = '';

        this.defaultSource = 'Roll20 Importer';

        this.showMissingAttribError = false;

        this.useTokenAsAvatar = false;
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
            console.log('DEBUG useTokenAsAvatar= ' + this.useTokenAsAvatar);

            this.showTokenName = html.find("select[name=showNameMode]").val();
            this.showTokenBars = html.find("select[name=showBarMode]").val();

            this.tokenBar1Link = html.find("select[name=tokenBar1Link]").val();
            this.tokenBar2Link = html.find("select[name=tokenBar2Link]").val();

            let targetMode = html.find("select[name=targetMode]").val();
            let targetCompendium = html.find("select[name=compendiumName]").val();
            let spellCompendium = html.find("select[name=spellCompendiumName]").val();
            if (spellCompendium == 'noComp') {
                this.spellCompendium = null;
            } else {
                this.spellCompendium = game.packs.find(p => p.collection === spellCompendium);
                this.spellCompendium.getIndex();
            }

            let files = html.find("input[name=fileUploads]").prop('files');

            let npcs = [];

            try {
                await this.loadFiles(files, npcs);
            } catch (e) {
                console.log('NPCImporter: There was a problem loading the files');
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
                    console.log('NPCImporter: Could not find compendium with the name ' + compendiumName);
                } else {
                    let npcName = this.getAttribute(npcData.attribs, 'npc_name');
                    console.log("NPCImporter: Creating npc named " + npcName);
                    let npc = Actor5e.create({ name: npcName, type: 'npc' }, { temporary: true, displaySheet: false }).then(async actor => {
                        await this.parseNpcData(actor, npcData, true);
                        console.log("NPCImporter: Importing into the compendium");
                        compendium.importEntity(actor);
                        //actor.delete();
                    });
                }
            } else {
                console.log('NPCImporter: No compendium name was given');
            }
        } else {
            let npcName = this.getAttribute(npcData.attribs, 'npc_name');
            console.log("NPCImporter: creating npc named " + npcName);
            Actor5e.create({ name: npcName, type: 'npc' }, { temporary: false, displaySheet:false }).then(async actor => {
                actor.render(false);
                await this.parseNpcData(actor, npcData, false);
            });
        }
    }

    /**
     * returns either the current or max value of the first attribute with the name specified
     * @param {Array} data - the array containing the attributes
     * @param {String} name - the name of the searched attribute
     * @param {boolean} getMaxValue - optional param, required if the max value is requested
     */
    getAttribute(data, name, getMaxValue = false) {
        
        //return "this is a test";
        let result = null;
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

    async parseNpcData(actor, npcData, tempActor) {
        console.log("NPCImporter: Parsing data");
        //let tmpActorItems = 
        let actorData = {};

        // set details
        actorData['name'] = this.getAttribute(npcData.attribs, 'npc_name');
        actorData['img'] = npcData.avatar;
        actorData['data.details.cr.value'] = parseInt(this.getAttribute(npcData.attribs, 'npc_challenge')); // parsing has to be done here since the value is needed for calculations
        
        let npcType = this.cleanTypeString(this.getAttribute(npcData.attribs, 'npc_type'))
        actorData['data.details.type.value'] = this.fixUpperCase(npcType.type);
        actorData['data.details.alignment.value'] = this.fixUpperCase(npcType.alignment);
        actorData['data.details.source.value'] = this.defaultSource;

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
        actorData['data.traits.size.value'] = this.fixUpperCase(npcType.size);//this.getSize(this.getAttribute(npcData.attribs, 'npc_type'));
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

        // set items
        let actorItems = [];
        // - collect all data of type 'repeated'
        let spells = {};
        let attacks = {};
        let feats = {};
        let legendarys = {};
        let reactions = {};


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
                        this.addEntryToItemTable(feats, entryId, entryName, entry.current);
                        break;
                    case 'npcaction':
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
                        spells = this.addEntryToItemTable(spells, entryId, entryName, entry.current);
                        break;
                    case 'npcreaction': 
                        this.addEntryToItemTable(reactions, entryId, entryName, entry.current);
                        break;
                    case 'npcaction-l':
                        this.addEntryToItemTable(legendarys, entryId, entryName, entry.current);
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

        // create and save items
        if (Object.keys(spells).length > 0) {
            for (let spellId in spells) {
                if (spells[spellId].spellname == 'CANTRIPS' || spells[spellId].spellname.indexOf('LEVEL') != -1)
                    continue;
                if (this.spellCompendium !== null) {
                    let spell = this.spellCompendium.index.find(e => e.name === spells[spellId].spellname);
                    if (spell != null && spell != undefined) {
                        console.log('NPCImporter: Found Spell ' + spells[spellId].spellname + ' in compendium, using that');
                        if (tempActor) {
                            spell = await this.spellCompendium.getEntry(spell['id']);
                            actorItems.push(spell);
                        } else {
                            actor.importItemFromCollection(this.spellCompendium.collection, spell['id']);
                        }
                        continue;
                    }
                } 

                let components = spells[spellId].spellcomp == undefined ? '' : spells[spellId].spellcomp;
                let concentration = spells[spellId].spellconcentration != null ? true : false;
                let damage = spells[spellId].spelldamage == undefined ? '' : spells[spellId].spelldamage;
                let damageType = spells[spellId].spelldamagetype == undefined ? '' : spells[spellId].spelldamagetype.toLowerCase();
                let description = spells[spellId].spelldescription == undefined ? spells[spellId].spellcontent : spells[spellId].spelldescription;
                let duration = spells[spellId].spellduration == undefined ? '' : spells[spellId].spellduration;
                let level = spells[spellId].spelllevel == 'cantrip' ? 0 : spells[spellId].spelllevel;
                let materials = spells[spellId].spellcompmaterials == undefined ? '' : spells[spellId].spellcompmaterials;
                let range = spells[spellId].spellrange == undefined ? '' : spells[spellId].spellrange;
                let ritual = spells[spellId].spellritual != null ? true : false;
                let save = spells[spellId].spellsave != null ? this.getShortformAbility(spells[spellId].spellsave) : '';
                let school = 'abj';
                if (spells[spellId].spellschool != undefined && spells[spellId].spellschool.length > 0)
                    school = this.getShortformSchool(spells[spellId].spellschool);
                let source = '';
                let spelltype = 'utility';
                if (spells[spellId].spellsave != null) {
                    spelltype = 'save';
                } else if (spells[spellId].spelloutput = 'ATTACK') {
                    spelltype = 'attack';
                }
                let target = spells[spellId].spelltarget == undefined ? '' : spells[spellId].spelltarget + '';
                let time = spells[spellId].spellcastingtime == undefined ? '' : spells[spellId].spellcastingtime + '';


                let spellObject = {
                    name: spells[spellId].spellname,
                    type: "spell",
                    img: 'icons/mystery-man.png',
                    data: {
                        components: { type: "String", label: "Spell Components", value: components },
                        concentration: { type: "Boolean", label: "Requires Concentration", value: concentration },
                        damage: { type: "String", label: "Spell Damage", value: damage },
                        damageType: { type: "String", label: "Damage Type", value: damageType },
                        description: { type: "String", label: "Description", value: description + '\n Cast at higher level:' + spells[spellId].spellathigherlevels },
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

                let name = attacks[attackId].name != undefined ? attacks[attackId].name : attacks[attackId].namedisplay;
                let description = attacks[attackId].desc == undefined ? attacks[attackId].description : attacks[attackId].desc;
                let bonus = attacks[attackId].attacktohit == undefined ? '' : (attacks[attackId].attacktohit - actorData['data.attributes.prof.value'] - strMod);
                let damage = attacks[attackId].attackdamage == undefined ? '' : attacks[attackId].attackdamage + '-' + strMod;
                let damageType = attacks[attackId].attackdamagetype == undefined ? '' : attacks[attackId].attackdamagetype.toLowerCase();
                let damage2 = attacks[attackId].attackdamage2 == undefined ? '' : attacks[attackId].attackdamage2 + '-' + strMod;
                let damage2Type = attacks[attackId].attackdamagetype2 == undefined ? '' : attacks[attackId].attackdamagetype2.toLowerCase();
                let range = attacks[attackId].attackrange == undefined ? '' : attacks[attackId].attackrange;

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
                        weight: { type: "Number", label: "Weight", value: 0 }
                    }
                };
                actorItems.push(attackObject);
            }
        }
        if (Object.keys(feats).length > 0) {
            for (let featId in feats) {
                let description = feats[featId].desc == undefined ? feats[featId].description : feats[featId].desc;

                let featObject = {
                    name: feats[featId].name,
                    type: 'feat',
                    data: {
                        damage: { type: "String", label: "Ability Damage", value: '' },
                        damageType: { type: "String", label: "Damage Type", value: '' },
                        description: { type: "String", label: "Description", value: description},
                        duration: { type: "String", label: "Duration", value: '' },
                        featType: { type: "String", label: "Feat Type", value: '' },
                        range: { type: "String", label: "Range", value: '' },
                        requirements: { type: "String", label: "Requirements", value: '' },
                        save: { type: "String", label: "Saving Throw", value: '' },
                        source: { type: "String", label: "Source", value: 'Roll20 NPC Importer'  },
                        target: { type: "String", label: "Target", value: '' },
                        time: { type: "String", label: "Casting Time", value: '' }
                    }
                };
                actorItems.push(featObject);
            }
        }

        // set token
        try {
            let npcTokenData = JSON.parse(npcData.defaulttoken.replace('\\', ''));
            actorData['token.displayName'] = parseInt(this.showTokenName); 
            actorData['token.name'] = actorData['name'];
            actorData['token.img'] = npcTokenData['imgsrc'];
            if (this.useTokenAsAvatar) {
                actorData['img'] = actorData['token.img'];
            }
            actorData['token.width'] = this.getTokenSize(actorData['data.traits.size.value']);
            actorData['token.height'] = actorData['token.width']
            if (npcTokenData['light_hassight'] == true) {
                actorData['token.dimSight'] = parseInt(npcTokenData['light_dimradius']);
                actorData['token.brightSight'] = parseInt(npcTokenData['light_radius']);
            }
            if (npcTokenData['light_otherplayers'] == true) {
                actorData['token.dimLight'] = parseInt(npcTokenData['light_dimradius']);
                actorData['token.brightLight'] = parseInt(npcTokenData['light_radius']);
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
     * splits a npctype string like "meadium Beast, unaligned" into 3 substrings containing type, size and alignement in seperate Strings
     * @param {String} npcString
     */
    cleanTypeString(npcString) {
        npcString = npcString.toLowerCase();
        let cleanString = {
            type: '',
            size: this.getSize(npcString),
            alignment: this.getAlignment(npcString)
        }

        cleanString.type = this.fixUpperCase(npcString.replace(cleanString.size, '').replace(cleanString.alignment, '')).trim().replace(',','');
        return cleanString;
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
            console.log('NPCImporter: Rolling for NPC health, formula: ' + formula + ', rollresult: ' + dice.total);
            return dice.total;
        } catch (e) {
            console.log('NPCImporter: Rolling for NPC health failed, formula: ' + formula + 'setting the default healt value to ' + this.defaultHealth);
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
        return string.replace(/(^|\s)([a-z])/g, function (m, p1, p2) { return p1 + p2.toUpperCase(); })
    }
}


let roll20NpcImporter = new Roll20NpcImporter();
//roll20NpcImporter.render(true);
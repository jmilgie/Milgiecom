(function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeCount(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.round(value));
  }

  function formatNumber(value) {
    const rounded = Math.round(value * 8) / 8;
    const whole = Math.trunc(rounded);
    const remainder = Math.round((rounded - whole) * 8);
    const fractions = {
      0: "",
      1: "1/8",
      2: "1/4",
      3: "3/8",
      4: "1/2",
      5: "5/8",
      6: "3/4",
      7: "7/8",
      8: ""
    };

    if (remainder === 0 || remainder === 8) {
      return String(Math.round(rounded));
    }

    if (whole === 0) {
      return fractions[remainder];
    }

    return whole + " " + fractions[remainder];
  }

  function wordFor(value, singular, plural) {
    return Math.abs(value - 1) < 0.001 ? singular : plural;
  }

  function qty(value, singular, plural) {
    return formatNumber(value) + " " + wordFor(value, singular, plural);
  }

  function qtyRange(min, max, singular, plural) {
    return formatNumber(min) + "-" + formatNumber(max) + " " + wordFor(max, singular, plural);
  }

  function maybePush(list, condition, value) {
    if (condition) {
      list.push(value);
    }
  }

  function joinSummary(parts) {
    return parts.filter(Boolean).join(", ");
  }

  function getFillCount(counts) {
    return counts.farmersCheese + counts.sauerkraut + counts.potato;
  }

  function getPierogiRange(counts) {
    const fillCount = getFillCount(counts);
    return {
      min: fillCount * 25,
      max: fillCount * 30
    };
  }

  function getDoughRange(counts) {
    return {
      min: counts.dough * 70,
      max: counts.dough * 90
    };
  }

  function getRecommendedDough(counts) {
    const fillCount = getFillCount(counts);

    if (!fillCount) {
      return 0;
    }

    return Math.ceil(fillCount / 3);
  }

  function getFinishingPlan(fillCount) {
    if (!fillCount) {
      return null;
    }

    if (fillCount <= 3) {
      return {
        onionMin: 1,
        onionMax: 2,
        butterStickMin: 1,
        butterStickMax: 2
      };
    }

    if (fillCount <= 6) {
      return {
        onionMin: 2,
        onionMax: 2,
        butterStickMin: 1,
        butterStickMax: 2
      };
    }

    return {
      onionMin: 2,
      onionMax: 3,
      butterStickMin: 2,
      butterStickMax: 3
    };
  }

  function getOverview(counts) {
    const fillCount = getFillCount(counts);
    const pierogi = getPierogiRange(counts);
    const doughYield = getDoughRange(counts);
    const recommendedDough = getRecommendedDough(counts);
    let doughStatus = "Add at least one filling batch to generate a dough recommendation.";
    let doughTone = "warning";

    if (fillCount && counts.dough === recommendedDough) {
      doughStatus = "Dough is matched to the filling plan using Aunt Flo's usual ratio.";
      doughTone = "good";
    } else if (fillCount && counts.dough < recommendedDough) {
      doughStatus = "Current dough is light for the filling plan. Match it before cooking day.";
      doughTone = "warning";
    } else if (fillCount && counts.dough > recommendedDough) {
      doughStatus = "You have extra dough planned for scraps, thicker rounds, or freezer insurance.";
      doughTone = "good";
    }

    return {
      fillCount: fillCount,
      pierogi: pierogi,
      doughYield: doughYield,
      recommendedDough: recommendedDough,
      doughStatus: doughStatus,
      doughTone: doughTone,
      finishing: getFinishingPlan(fillCount)
    };
  }

  function controlSummary(counts) {
    const parts = [];

    maybePush(parts, counts.farmersCheese > 0, "farmer's cheese x" + counts.farmersCheese);
    maybePush(parts, counts.sauerkraut > 0, "sauerkraut x" + counts.sauerkraut);
    maybePush(parts, counts.potato > 0, "potato x" + counts.potato);

    return parts.join(" | ");
  }

  function buildMasterShoppingGroups(counts, overview) {
    const groups = [];
    const finishing = overview.finishing;
    const totalEggs = counts.dough * 2 + counts.farmersCheese * 3;
    const produceItems = [];
    const dairyItems = [];
    const pantryItems = [];
    const fermentedItems = [];
    const finishingItems = [];

    if (overview.fillCount) {
      const onionMin = counts.sauerkraut + counts.potato * 0.75 + finishing.onionMin;
      const onionMax = counts.sauerkraut + counts.potato + finishing.onionMax;

      produceItems.push({
        id: "shopping-onions-total",
        text: qtyRange(Math.ceil(onionMin), Math.ceil(onionMax), "onion total", "onions total"),
        meta: "Covers sauerkraut filling, potato filling, and the buttery finish."
      });
    }

    if (counts.potato > 0) {
      produceItems.push({
        id: "shopping-russet-potatoes",
        text: qty(counts.potato * 2, "lb", "lbs") + " russet potatoes",
        meta: "Peel and cube before boiling."
      });
    }

    if (produceItems.length) {
      groups.push({
        id: "master-produce",
        title: "Produce",
        items: produceItems
      });
    }

    if (counts.farmersCheese > 0) {
      dairyItems.push({
        id: "shopping-farmers-cheese",
        text: qty(counts.farmersCheese, "package", "packages") + " farmer's cheese",
        meta: "About 15 oz per package."
      });
    }

    if (totalEggs > 0) {
      const eggMeta = [];

      maybePush(
        eggMeta,
        counts.dough > 0,
        qty(counts.dough * 2, "whole egg", "whole eggs") + " for dough"
      );
      maybePush(
        eggMeta,
        counts.farmersCheese > 0,
        qty(counts.farmersCheese * 3, "extra egg", "extra eggs") + " for yolks"
      );

      if (totalEggs >= 13 && totalEggs <= 18) {
        eggMeta.push("An 18-count carton covers this cleanly");
      }

      dairyItems.push({
        id: "shopping-eggs-total",
        text: qty(totalEggs, "egg required", "eggs required"),
        meta: eggMeta.join(". ") + "."
      });
    }

    if (counts.dough > 0) {
      dairyItems.push({
        id: "shopping-half-and-half",
        text: qty(counts.dough * 0.75, "cup", "cups") + " half-and-half",
        meta: "For the dough."
      });
      dairyItems.push({
        id: "shopping-sour-cream",
        text: qty(counts.dough, "heaping tbsp", "heaping tbsp") + " full-fat sour cream",
        meta: "For the dough."
      });
    }

    if (counts.potato > 0) {
      dairyItems.push({
        id: "shopping-cheddar",
        text: qty(counts.potato, "cup", "cups") + " shredded sharp cheddar",
        meta: "Optional, but excellent in the potato filling.",
        optional: true
      });
      dairyItems.push({
        id: "shopping-potato-butter",
        text: qtyRange(counts.potato * 3, counts.potato * 4, "tbsp", "tbsp") + " butter",
        meta: "For the potato filling."
      });
    }

    if (dairyItems.length) {
      groups.push({
        id: "master-dairy",
        title: "Dairy and eggs",
        items: dairyItems
      });
    }

    if (counts.dough > 0) {
      pantryItems.push({
        id: "shopping-flour",
        text: qty(counts.dough * 4, "cup", "cups") + " unbleached flour",
        meta: "Keep a little extra flour around for light dusting."
      });
      pantryItems.push({
        id: "shopping-salt",
        text: qty(counts.dough * 0.5, "tsp", "tsp") + " salt",
        meta: "Plus extra for seasoning fillings and boiling water."
      });
    }

    if (counts.farmersCheese > 0 || counts.sauerkraut > 0) {
      const sugarMin = counts.farmersCheese * 2 + counts.sauerkraut;
      const sugarMax = counts.farmersCheese * 2 + counts.sauerkraut * 2;
      pantryItems.push({
        id: "shopping-sugar",
        text: qtyRange(sugarMin, sugarMax, "tsp", "tsp") + " sugar",
        meta: "Lightly sweetens the cheese filling and balances the sauerkraut."
      });
    }

    if (counts.sauerkraut > 0) {
      pantryItems.push({
        id: "shopping-kraut-fat",
        text: qtyRange(counts.sauerkraut, counts.sauerkraut * 2, "tbsp", "tbsp") + " olive oil or butter",
        meta: "For browning the sauerkraut filling onions."
      });
    }

    if (pantryItems.length) {
      groups.push({
        id: "master-pantry",
        title: "Pantry",
        items: pantryItems
      });
    }

    if (counts.sauerkraut > 0) {
      fermentedItems.push({
        id: "shopping-sauerkraut",
        text: qty(counts.sauerkraut, "lb", "lbs") + " sauerkraut",
        meta: "Drain, rinse, and squeeze it very dry."
      });
    }

    if (fermentedItems.length) {
      groups.push({
        id: "master-fermented",
        title: "Fermented",
        items: fermentedItems
      });
    }

    if (finishing) {
      finishingItems.push({
        id: "shopping-finishing-onions",
        text: qtyRange(finishing.onionMin, finishing.onionMax, "extra onion", "extra onions"),
        meta: "For pan frying or serving."
      });
      finishingItems.push({
        id: "shopping-finishing-butter",
        text: qtyRange(finishing.butterStickMin, finishing.butterStickMax, "stick", "sticks") + " butter",
        meta: "For the final buttery fry.",
        optional: true
      });
      finishingItems.push({
        id: "shopping-pepper",
        text: "Black pepper",
        meta: "Optional in the sauerkraut and potato fillings.",
        optional: true
      });
    }

    if (finishingItems.length) {
      groups.push({
        id: "master-finishing",
        title: "Finishing and serving",
        items: finishingItems
      });
    }

    return groups;
  }

  function buildComponentGroups(counts) {
    const groups = [];

    if (counts.dough > 0) {
      groups.push({
        id: "component-dough",
        title: "Dough x" + counts.dough,
        subtitle: qtyRange(counts.dough * 70, counts.dough * 90, "pierogi worth", "pierogi worth"),
        note: "One dough batch usually covers about three filling batches.",
        staticItems: [
          qty(counts.dough * 4, "cup", "cups") + " unbleached flour",
          qty(counts.dough * 0.5, "tsp", "tsp") + " salt",
          qty(counts.dough * 2, "large egg", "large eggs"),
          qty(counts.dough * 0.75, "cup", "cups") + " half-and-half",
          qty(counts.dough, "heaping tbsp", "heaping tbsp") + " full-fat sour cream"
        ]
      });
    }

    if (counts.farmersCheese > 0) {
      groups.push({
        id: "component-cheese",
        title: "Farmer's cheese filling x" + counts.farmersCheese,
        subtitle: qtyRange(counts.farmersCheese * 25, counts.farmersCheese * 30, "pierogi", "pierogi"),
        note: "Lightly sweet, not dessert sweet.",
        staticItems: [
          qty(counts.farmersCheese, "package", "packages") + " farmer's cheese",
          qty(counts.farmersCheese * 3, "egg yolk", "egg yolks"),
          qty(counts.farmersCheese * 2, "tsp", "tsp") + " sugar",
          "Optional pinch of salt"
        ]
      });
    }

    if (counts.sauerkraut > 0) {
      groups.push({
        id: "component-kraut",
        title: "Sauerkraut filling x" + counts.sauerkraut,
        subtitle: qtyRange(counts.sauerkraut * 25, counts.sauerkraut * 30, "pierogi", "pierogi"),
        note: "The key is cooking out the moisture before filling.",
        staticItems: [
          qty(counts.sauerkraut, "lb", "lbs") + " sauerkraut",
          qty(counts.sauerkraut, "medium onion", "medium onions"),
          qtyRange(counts.sauerkraut, counts.sauerkraut * 2, "tbsp", "tbsp") + " olive oil or butter",
          qtyRange(counts.sauerkraut, counts.sauerkraut * 2, "tsp", "tsp") + " sugar",
          "Optional black pepper"
        ]
      });
    }

    if (counts.potato > 0) {
      groups.push({
        id: "component-potato",
        title: "Potato filling x" + counts.potato,
        subtitle: qtyRange(counts.potato * 25, counts.potato * 30, "pierogi", "pierogi"),
        note: "Smooth, seasoned, and fully cool before stuffing.",
        staticItems: [
          qty(counts.potato * 2, "lb", "lbs") + " russet potatoes",
          qty(counts.potato, "cup", "cups") + " shredded sharp cheddar (optional)",
          qty(counts.potato * 0.5, "cup", "cups") + " sauteed onion",
          qtyRange(counts.potato * 3, counts.potato * 4, "tbsp", "tbsp") + " butter",
          "Salt and pepper to taste"
        ]
      });
    }

    return groups;
  }

  function buildShoppingPhase(counts) {
    const overview = getOverview(counts);
    const groups = buildMasterShoppingGroups(counts, overview);
    const componentGroups = buildComponentGroups(counts);

    return {
      header: {
        kicker: "Shopping list",
        title: "Shop once for the whole pierogi run",
        description: "Scale ingredients by batch count, check off the master list, then glance at component cards if you prep in waves."
      },
      highlights: [
        {
          label: "Estimated yield",
          value: overview.fillCount ? qtyRange(overview.pierogi.min, overview.pierogi.max, "pierogi", "pierogi") : "No fillings planned"
        },
        {
          label: "Fillings planned",
          value: overview.fillCount ? qty(overview.fillCount, "batch", "batches") : "0 batches"
        },
        {
          label: "Suggested dough",
          value: overview.recommendedDough ? qty(overview.recommendedDough, "batch", "batches") : "Set fillings first"
        }
      ],
      sections: [
        {
          id: "shopping-master",
          title: "Master grocery list",
          body: overview.fillCount || counts.dough ? "Use this first while you shop." : "Add dough or filling batches to generate a grocery list.",
          groups: groups
        },
        {
          id: "shopping-components",
          title: "Scaled recipe cards",
          body: "Helpful if you buy or prep one component at a time.",
          groups: componentGroups
        }
      ],
      aside: [
        {
          tone: overview.doughTone === "good" ? "cool" : "alert",
          title: "Dough match",
          body: overview.doughStatus
        },
        {
          tone: "warm",
          title: "Planning notes",
          items: [
            "Farmer's cheese, sauerkraut, and potato fillings can all be made 1-3 days ahead.",
            "If you are doing a big freezer day, clear tray space before assembly starts.",
            "Sauerkraut should be very dry before it ever touches the dough."
          ]
        }
      ]
    };
  }

  function buildPrepGroups(counts) {
    const groups = [];

    if (counts.farmersCheese > 0) {
      groups.push({
        id: "prep-cheese",
        title: "Farmer's cheese filling x" + counts.farmersCheese,
        subtitle: joinSummary([
          qty(counts.farmersCheese, "package", "packages") + " farmer's cheese",
          qty(counts.farmersCheese * 3, "yolk", "yolks"),
          qty(counts.farmersCheese * 2, "tsp", "tsp") + " sugar"
        ]),
        note: "This can be made a few days early and kept chilled.",
        items: [
          {
            id: "prep-cheese-mix",
            text: "Mix the farmer's cheese, yolks, sugar, and optional pinch of salt until smooth."
          },
          {
            id: "prep-cheese-taste",
            text: "Taste and adjust the sugar slightly if needed.",
            meta: "Keep it lightly sweet rather than dessert sweet."
          },
          {
            id: "prep-cheese-chill",
            text: "Cover and chill the filling until it is fully cool."
          }
        ]
      });
    }

    if (counts.sauerkraut > 0) {
      groups.push({
        id: "prep-kraut",
        title: "Sauerkraut filling x" + counts.sauerkraut,
        subtitle: joinSummary([
          qty(counts.sauerkraut, "lb", "lbs") + " sauerkraut",
          qty(counts.sauerkraut, "medium onion", "medium onions"),
          qtyRange(counts.sauerkraut, counts.sauerkraut * 2, "tbsp", "tbsp") + " oil or butter"
        ]),
        note: "Dry sauerkraut means stronger seals and far fewer blowouts.",
        items: [
          {
            id: "prep-kraut-dry",
            text: "Drain, rinse, and squeeze the sauerkraut very dry."
          },
          {
            id: "prep-kraut-onions",
            text: "Brown the diced onions in oil or butter."
          },
          {
            id: "prep-kraut-cook",
            text: "Add the sauerkraut and cook until softened, lightly browned, and no longer wet."
          },
          {
            id: "prep-kraut-finish",
            text: "Add sugar and optional black pepper near the end."
          },
          {
            id: "prep-kraut-cool",
            text: "Cool the filling completely before assembly."
          }
        ]
      });
    }

    if (counts.potato > 0) {
      groups.push({
        id: "prep-potato",
        title: "Potato filling x" + counts.potato,
        subtitle: joinSummary([
          qty(counts.potato * 2, "lb", "lbs") + " russet potatoes",
          qty(counts.potato * 0.5, "cup", "cups") + " sauteed onion",
          qtyRange(counts.potato * 3, counts.potato * 4, "tbsp", "tbsp") + " butter"
        ]),
        note: "Mash smooth, season well, then cool it down before stuffing.",
        items: [
          {
            id: "prep-potato-boil",
            text: "Boil the peeled, cubed potatoes until fork tender."
          },
          {
            id: "prep-potato-mash",
            text: "Mash with butter, sauteed onion, and cheddar if you are using it."
          },
          {
            id: "prep-potato-season",
            text: "Season with salt and pepper until the filling tastes lively."
          },
          {
            id: "prep-potato-cool",
            text: "Chill or cool the filling completely before shaping."
          }
        ]
      });
    }

    if (counts.dough > 0) {
      groups.push({
        id: "prep-dough",
        title: "Dough x" + counts.dough,
        subtitle: joinSummary([
          qty(counts.dough * 4, "cup", "cups") + " flour",
          qty(counts.dough * 2, "egg", "eggs"),
          qty(counts.dough * 0.75, "cup", "cups") + " half-and-half"
        ]),
        note: "The dough should feel soft and smooth, not sticky.",
        items: [
          {
            id: "prep-dough-mix",
            text: "Mix the flour and salt, make a well, then add eggs plus the half-and-half and sour cream mixture."
          },
          {
            id: "prep-dough-form",
            text: "Pull the flour in gradually with a fork until a dough forms."
          },
          {
            id: "prep-dough-knead",
            text: "Knead for about 10 minutes until smooth and elastic."
          },
          {
            id: "prep-dough-rest",
            text: "Cover and rest the dough for 30 minutes."
          },
          {
            id: "prep-dough-roll",
            text: "Divide into thirds, run through the pasta machine at 1, 3, then 5, and cut 3-inch rounds."
          }
        ]
      });
    }

    if (counts.dough > 0 || getFillCount(counts) > 0) {
      groups.push({
        id: "prep-station",
        title: "Assembly station",
        subtitle: "Set this up before the first round gets filled.",
        note: "A calm setup matters when you are making a lot of pierogi.",
        items: [
          {
            id: "prep-station-trays",
            text: "Flour towels or trays before you start shaping."
          },
          {
            id: "prep-station-cool",
            text: "Keep every filling cool and keep dough pieces covered while waiting."
          },
          {
            id: "prep-station-tools",
            text: "Set out a fork, bench space, and enough room for finished pierogi to rest flat."
          }
        ]
      });
    }

    return groups;
  }

  function buildPrepPhase(counts) {
    const overview = getOverview(counts);

    return {
      header: {
        kicker: "Prep",
        title: "Front-load the calm parts",
        description: "Use the make-ahead advantage. Fillings can be finished early, then dough and setup happen closer to shaping time."
      },
      highlights: [
        {
          label: "Make ahead",
          value: "Fillings hold 1-3 days chilled"
        },
        {
          label: "Current plan",
          value: controlSummary(counts) || "Set batches to begin"
        },
        {
          label: "Seal insurance",
          value: "Cool fillings and dry kraut"
        }
      ],
      sections: [
        {
          id: "prep-sections",
          title: "Prep checklist",
          body: "Work top to bottom, or split the cards between helpers.",
          groups: buildPrepGroups(counts)
        }
      ],
      aside: [
        {
          tone: "cool",
          title: "Why this recipe scales well",
          body: "Most of the workload sits in the fillings, and all three can be finished before assembly day."
        },
        {
          tone: "warm",
          title: "Texture guardrails",
          items: [
            "Dough should feel soft, not sticky.",
            "Sauerkraut must be cooked dry before filling.",
            "Every filling should be fully cool before it touches the dough.",
            overview.fillCount > 6 ? "For a big run, recruit one person to roll while another fills." : "A single person can move steadily if the station is already organized."
          ]
        }
      ]
    };
  }

  function buildCookGroups(counts) {
    const groups = [];
    const fillCount = getFillCount(counts);

    if (fillCount > 0) {
      groups.push({
        id: "cook-assembly",
        title: "Fill and seal",
        subtitle: "Shaping stays faster when each round gets the same amount of filling.",
        note: "Do not overfill. Seal integrity matters more than squeezing in extra filling.",
        items: [
          {
            id: "cook-assembly-fill",
            text: "Place filling in the center of each dough round."
          },
          {
            id: "cook-assembly-fold",
            text: "Fold over and seal firmly by pinching or crimping."
          },
          {
            id: "cook-assembly-hold",
            text: "Lay finished pierogi on a floured towel or tray while you continue."
          }
        ]
      });
    }

    if (fillCount > 0) {
      groups.push({
        id: "cook-boil",
        title: "Boil in batches",
        subtitle: "A wide pot and a steady simmer make this cleaner.",
        note: "Pull them out as soon as they float.",
        items: [
          {
            id: "cook-boil-water",
            text: "Bring a large pot of salted water to a boil."
          },
          {
            id: "cook-boil-batches",
            text: "Cook the pierogi in batches so they have room to move."
          },
          {
            id: "cook-boil-float",
            text: "Lift them out once they float to the top."
          }
        ]
      });
    }

    if (fillCount > 0) {
      groups.push({
        id: "cook-cool",
        title: "Cool, hold, or freeze",
        subtitle: "This is the part that saves the batch from sticking together.",
        note: "Cool on trays first, then store.",
        items: [
          {
            id: "cook-cool-rack",
            text: "Spread the boiled pierogi on rack-lined baking sheets to cool."
          },
          {
            id: "cook-cool-paper",
            text: "Transfer cooled pierogi to lightly greased wax or parchment paper."
          },
          {
            id: "cook-cool-freeze",
            text: "Freeze in a single layer before bagging if you are storing them."
          }
        ]
      });
    }

    if (fillCount > 0) {
      groups.push({
        id: "cook-finish",
        title: "Butter-fry to finish",
        subtitle: "Optional, but this is the restaurant move.",
        note: "Saute onions first, then let the pierogi get golden.",
        items: [
          {
            id: "cook-finish-onions",
            text: "Cook onions in butter until soft and golden.",
            optional: true
          },
          {
            id: "cook-finish-pierogi",
            text: "Pan fry the boiled pierogi until the outsides turn golden.",
            optional: true
          }
        ]
      });
    }

    return groups;
  }

  function buildCookPhase(counts) {
    const overview = getOverview(counts);

    return {
      header: {
        kicker: "Cook",
        title: "Use the live guide at the stove",
        description: "Once shaping starts, this view keeps only the assembly, boiling, cooling, and finishing details in front of you."
      },
      highlights: [
        {
          label: "Assembly line",
          value: "Center filling, then seal tight"
        },
        {
          label: "Boiling cue",
          value: "Lift them when they float"
        },
        {
          label: "Current yield",
          value: overview.fillCount ? qtyRange(overview.pierogi.min, overview.pierogi.max, "pierogi", "pierogi") : "Set batches first"
        }
      ],
      sections: [
        {
          id: "cook-sections",
          title: "Cook checklist",
          body: "This is the stripped-down service view for the counter or stovetop.",
          groups: buildCookGroups(counts)
        }
      ],
      aside: [
        {
          tone: overview.fillCount > 6 ? "alert" : "warm",
          title: "Production tip",
          body: overview.fillCount > 6
            ? "This is a serious freezer day. Cool and freeze in single layers so the batch does not glue together."
            : "Even a smaller batch benefits from trays that are ready before the first pierogi comes out of the pot."
        },
        {
          tone: "cool",
          title: "Serving note",
          items: [
            "Butter and onions are the classic finish.",
            "Leftover boiled pierogi reheat beautifully in a pan the next day.",
            "A little extra black pepper works especially well on sauerkraut and potato batches."
          ]
        }
      ]
    };
  }

  function createPierogiRecipe() {
    return {
      id: "aunt-flo-pierogi",
      title: "Aunt Flo's Pierogi",
      path: "./pierogi.html",
      getControls: function () {
        return [
          {
            id: "dough",
            label: "Dough",
            description: "About 70-90 pierogi per batch",
            defaultValue: 1,
            min: 0,
            max: 12
          },
          {
            id: "farmersCheese",
            label: "Farmer's cheese",
            description: "Sweet cheese filling",
            defaultValue: 1,
            min: 0,
            max: 12
          },
          {
            id: "sauerkraut",
            label: "Sauerkraut",
            description: "Cooked until dry and mellow",
            defaultValue: 1,
            min: 0,
            max: 12
          },
          {
            id: "potato",
            label: "Potato",
            description: "Traditional potato and onion filling",
            defaultValue: 1,
            min: 0,
            max: 12
          }
        ];
      },
      getPhases: function () {
        return [
          { id: "shopping", label: "Shopping list" },
          { id: "prep", label: "Prep" },
          { id: "cook", label: "Cook" }
        ];
      },
      getPresets: function () {
        return [
          {
            label: "1 each filling",
            values: {
              dough: 1,
              farmersCheese: 1,
              sauerkraut: 1,
              potato: 1
            }
          },
          {
            label: "3 each filling",
            values: {
              dough: 3,
              farmersCheese: 3,
              sauerkraut: 3,
              potato: 3
            }
          }
        ];
      },
      normalizeCounts: function (counts) {
        const next = {};
        this.getControls().forEach(function (control) {
          const raw = counts && counts[control.id];
          next[control.id] = clamp(normalizeCount(raw == null ? control.defaultValue : raw), control.min, control.max);
        });
        return next;
      },
      getHero: function (counts) {
        const overview = getOverview(counts);

        return {
          eyebrow: "Family recipe | make-ahead friendly",
          title: "Aunt Flo's Pierogi",
          summary: "Sweet farmer's cheese, sauerkraut, and potato pierogi, rebuilt into a guided kitchen flow that scales by batch and keeps progress saved.",
          stats: [
            {
              label: "Views",
              value: "3 phase guide"
            },
            {
              label: "Make ahead",
              value: "Fillings 1-3 days early"
            },
            {
              label: "Current yield",
              value: overview.fillCount ? qtyRange(overview.pierogi.min, overview.pierogi.max, "pierogi", "pierogi") : "Set fillings first"
            }
          ]
        };
      },
      getLandingCard: function () {
        return {
          title: "Aunt Flo's Pierogi",
          kicker: "Family recipe",
          summary: "A guided pierogi planner with batch scaling, make-ahead filling prep, and a clean cook-day checklist.",
          tags: ["Shopping list", "Prep", "Cook", "Make ahead", "Freezer day"],
          href: "./pierogi.html",
          status: "Live recipe"
        };
      },
      getOverview: function (counts) {
        return getOverview(counts);
      },
      buildPhase: function (phaseId, counts) {
        if (phaseId === "shopping") {
          return buildShoppingPhase(counts);
        }

        if (phaseId === "prep") {
          return buildPrepPhase(counts);
        }

        return buildCookPhase(counts);
      }
    };
  }

  window.COOKBOOK_RECIPES = {
    "aunt-flo-pierogi": createPierogiRecipe()
  };
})();

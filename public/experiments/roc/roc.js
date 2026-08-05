//rocketnitza
//const fs = require('fs');
const CMNTS = false;
const GOB = {
    ready_dots: [], // [2, 3, <ord number of dot>]
    dots: {}, // different info about dots, e.g. 'can_hap_overt_behind'
};

//function main(MATR_H, MATR_W, MAX_AIMS)
function main(arg)
{
    // arg = {handle: false, matr: [[],[]] } || {handle: false, matr_w: 20, matr_h: 12, max_aims: 8}
    console.time("concatenation");
    if (arg.handle) {
        arg.matr = trim_matr_by_max_aims(arg.matr, arg.max_aims);
        return fast_exit(arg.matr, arg.max_aims, arg.matr.length);
    }
    else {
        let BIN_MATR = getFieldRandomBit([arg.matr_h, arg.matr_w]);
        //else { BIN_MATR = getFieldRandomBit([30, 50]);
        BIN_MATR = trim_matr_by_max_aims(BIN_MATR, arg.max_aims);
        return fast_exit(BIN_MATR, arg.max_aims, arg.matr_h);
    }

}

function getHandleBitMatr(MATR_H, MATR_W){
        let res= [];
        for (let row=0; row<MATR_H; row++){
            let line = [];
            for (let col=0; col<MATR_W; col++){
                line[col] = 0;
            }
            res.push(line);
        }
        let test_matr =
[
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0]
]

        let test_matr_w = test_matr[0].length,
            test_matr_h = test_matr.length;

        let MAX_AIMS_ = (Math.floor( test_matr_h/(2+1) )) * 2 ;
        if (test_matr_h % 3 == 2)  {MAX_AIMS_ = MAX_AIMS_ + 2}
        return {matr_h: test_matr_h, bin_matr: test_matr, max_aims: MAX_AIMS_}
        //return res;
    }

function trim_matr_by_max_aims(BIN_MATR, MAX_AIMS) {
    let dots_counter = 0;
    for (let row = 0; row < BIN_MATR.length; row++){
        for (let col = 0; col < BIN_MATR[0].length; col++){
            if (BIN_MATR[row][col] > 0) {
                dots_counter++;
                if (dots_counter > MAX_AIMS) {
                    BIN_MATR[row][col] = 0;
                }
            }
        }
    }
    return BIN_MATR;
}

function fast_exit(BIN_MATR, MAX_AIMS, MATR_H)
{
    console.log(convert_to_string(BIN_MATR));
    let result = {};
    GOB.MAX_AIMS = MAX_AIMS;
    // * ESTIMATE matrix width from matr
    const MATR_W = (BIN_MATR.length > 0) ? BIN_MATR[0].length : null;
	// * 1) DISTANCE_ARR = [{id:id, xc:xc, yc:yc},{...},{...}]
	const DISTANCE_ARR = get_distances_array(BIN_MATR);

    // * clone and sort array. Like DISTANCE_ARR, but flat and sorted by xc
    // * then get useful info except empty xc
	let dist_arr = clone_and_sort_objarr(DISTANCE_ARR);
	dist_arr = get_useful_from_obj(dist_arr);
	// * DIST_IDS = [id1, id2]; DIST_XCS = [xc1, xc2];
    const DIST_IDS = get_arr_prop(dist_arr,"id");
	const DIST_XCS = get_arr_prop(dist_arr, "xc");
    //if (DIST_XCS.length - MAX_AIMS > 0 ) {DIST_XCS = DIST_XCS.slice(0, MAX_AIMS);}

    ////console.log("DIST_XCS = ", DIST_XCS);
	// * 2) mid_data = {min_dist, middle_true, true_k};
	const MID_DATA = count_sigma_in_halfs({dist_xcs: DIST_XCS, matr_w: MATR_W, max_aims: MAX_AIMS});
    if (MID_DATA.error){ result.error = MID_DATA.error; }
    else {

        // * IDS_L = [id1, id2, ...]
        const IDS_L = DIST_IDS.slice(0, MID_DATA.middle_true);
        const IDS_R = DIST_IDS.slice(MID_DATA.middle_true, DIST_IDS.length);
        result.id_l = IDS_L;
            ////console.log("IDS_L = ", IDS_L,", IDS_R = ", IDS_R);
            // * 3) DIST_MATR = [ [{...},{...}], [{...},{...}] ]
        const DIST_MATR = reshape_2d_and_add_prop_side(DISTANCE_ARR, MATR_W, IDS_L);
        GOB.dist_matr = DIST_MATR;
        result.arr2d = DIST_MATR;

        // * paths_kit - is a matrix with size like source binary matrix, containing all paths
        result.paths_kit = get_paths_matr( {dist_matr: DIST_MATR, ids_l: IDS_L, ids_r: IDS_R, matr_h: MATR_H, mid_data: MID_DATA} );
        //console.log(convert_to_string(paths_kit.paths_matr));
    }

    return result;

}

function convert_to_string(matr){
    let str = "[\r\n";
    for (let row = 0; row < matr.length; row++) {
        str += "[";
        for (let col = 0; col < matr[0].length; col++) {
            str += matr[row][col];
            if (col != matr[0].length - 1) str += ","
        }
        if (row == matr.length - 1) str += "]\r\n";
        else str += "],\r\n";
    }
    str += "]"
    return str;
}

function get_paths_matr(arg)
{
    // arg = { dist_matr: [ [{}], [{}] ], ids_l: [], ids_r: [], matr_h: 10 }
	// IMPORTANT: x,y coords in "simle numeric matrix" one less than in "distance object matrix"
    const AIM_H = arg.aim_h || 2;
    const ORD_MATR = init_paths_matr(arg);
    const PATHS_MATR = init_paths_matr(arg);
    ////console.log("ORD_MATR = ",ORD_MATR);
    ////console.log("PATHS_MATR = ",PATHS_MATR);

	const POCKET = build_pocket({dist_tool: arg, aim_h: AIM_H});

    // * imagine that we got one dot and execute function which find path for it
    // * path1 = [ [x1,y1], [x2,y2], [x3,y3] ]; PATHS = {path1: [[],[]], path2: [[],[]]}
	////console.log("======================");

    // * little optimization, which make sense to look only on columns contains left or right
    let grid_ = {};
    grid_.mid_xc = get_half_index_of_matr({ord_matr: ORD_MATR, dist_matr: arg.dist_matr });

    // * Now we need to create a more favorable distribution before you start creating paths
    // * this applies especially to those Dots that are more in depth of the grid
    grid_.is_mid_dif = is_mid_xc_contain_different_dots({ dist_tool: arg, mid_xc: grid_.mid_xc});

    // * we will go by slicing stripes with increasing X axis
    const PATHS = {};
    // * for the left half, the order of columns is served from the first to N
    //for (let col = 0; col <= 1; col++) {
    for (let col = 0; col <= grid_.mid_xc; col++) {
        let unresolved = solve_one_bar({paths_matr: PATHS_MATR, ord_matr: ORD_MATR, column: col, dist_tool: arg, pocket: POCKET, paths: PATHS, mid_xc: grid_.mid_xc, for_side: "left"});
        // TODO: if (unresolved) { solve_one_bar_pass2(); }
	}
    // * for the right half, the order of columns is served from the last decreasing to middle xc
    //for (let col = ORD_MATR[0].length-1; col >= ORD_MATR[0].length-3; col--){
    for (let col = ORD_MATR[0].length-1; col >= grid_.mid_xc; col--){
        let unresolved = solve_one_bar({paths_matr: PATHS_MATR, ord_matr: ORD_MATR, column: col, dist_tool: arg, pocket: POCKET, paths: PATHS, mid_xc: grid_.mid_xc, for_side: "right"});
        // TODO: if (unresolved) { solve_one_bar_pass2(); }
    }

    ////console.log("PATHS",JSON.stringify(PATHS));
	console.timeEnd("concatenation");
    return {paths_matr: PATHS_MATR, paths: PATHS};

    //-------- INNER FUNCTIONS ---------
    function is_mid_xc_contain_different_dots(arg)
    {
        // * arg = dist_tool: {}, mid_xc: 6
        let mid_dots = [];
        for (let row = 0; row < arg.dist_tool.dist_matr.length; row++) {
            let one_dot = arg.dist_tool.dist_matr[row][arg.mid_xc];
            if (one_dot.yc > -1 ) { mid_dots.push(one_dot); }
        }
        // TODO: ADD NEW PROPERTY 'PRE_VDIR' TO DOT OBJECT, BASED ON FACT OF SITUATION, WHEN MANY DOTS ARE ON THE MIDDLE XC AND DOT WHICH IS LOWER MUST GRAVITATE TO LOWER AIM AND VICE VERSA

        if (mid_dots.length > 0) {
            let mid = Math.floor(mid_dots.length/2);
            for (let i = 0; i < mid; i++) { mid_dots[i].pre_vdir = "up"; }
            for (let i = mid; i < mid_dots.length; i++) { mid_dots[i].pre_vdir = "down"; }
        }
        return mid_dots;
    }

    function init_paths_matr(dist_tool){
        // dist_tool = {dist_matr: [ [{}], [{}] ], ids_l: [id1,id3], ids_r: [id2,id4]}
        let res_matr = [];
        const HEIGHT = dist_tool.dist_matr.length,
			   WIDTH = dist_tool.dist_matr[0].length;
        for (let row=0; row < HEIGHT; row++) {
            let vec = [];
            for (let col=0; col < WIDTH; col++) {
                let ord = dist_tool.dist_matr[row][col].ord;
                if(ord){ vec.push(Number(ord)); }
                else { vec.push(0); }
            }
            res_matr.push(vec);
        }
        return res_matr;
    }

    function get_half_index_of_matr(arg)
    {
        // * arg = {ord_matr: [[],[]], dist_matr: [[{}],[{}]] }
        let half_index = -1, last_left = -1, first_right = -1;
        for (let col=0; col < arg.ord_matr[0].length; col++) {
            for (let row=0; row < ORD_MATR.length; row++) {
                const DOT_OBJ = arg.dist_matr[row][col];
                if (DOT_OBJ.side == "left") { last_left = col; }
                else if (DOT_OBJ.side == "right") {
                    if (first_right == -1) { first_right = col; }
                }
            }
            if (last_left > -1) { half_index = last_left; }
            else if (first_right > -1) { half_index = first_right; }

            if ( (last_left > -1)&&(first_right > -1) ) {
                half_index = Math.floor( (last_left + first_right) / 2 );
            }
        }
        return half_index;
    }

}

//------------------------------------
// ----- CREATE POCKETS OBJECT -------
//------------------------------------
function build_pocket(arg)
{
	// * arg = { dist_tool: {dist_matr: [ [{}], [{}] ], ids_l: [], ids_r: [], matr_h: 10}, aim_h: 2 }
    const VOID = arg.void || 1;
	let pocket = {};
	pocket.aims_vecs = {};
	pocket.aims_objs = {};
	pocket.aims_ = {};
	pocket.aims_vecs.left = build_pocket_aim_vec({matr_h: arg.dist_tool.matr_h, aim_h: arg.aim_h, dist_tool: arg.dist_tool, side: "left", void: VOID });
	pocket.aims_vecs.right = build_pocket_aim_vec({matr_h: arg.dist_tool.matr_h, aim_h: arg.aim_h, dist_tool: arg.dist_tool, side: "right", void: VOID });
	pocket.aims_objs.left = create_pocket_aim_obj({dist_tool: arg.dist_tool, aim_h: arg.aim_h, side: "left", void: VOID});
	pocket.aims_objs.right = create_pocket_aim_obj({dist_tool: arg.dist_tool, aim_h: arg.aim_h, side: "right",void: VOID});
	pocket.aims_.left = create_pocket_aim_obj_2({dist_tool: arg.dist_tool, aim_h: arg.aim_h, side: "left", void: VOID});
	pocket.aims_.right = create_pocket_aim_obj_2({dist_tool: arg.dist_tool, aim_h: arg.aim_h, side: "right", void: VOID});
	return pocket;

    function build_pocket_aim_vec(dat)
	{
        //console.log("dat=",Object.keys(dat));
        //console.log("matr_h=",dat.matr_h);
        // dat = {matr_h: MATR_H, aim_h: 2, dist_tool: {dist_matr: [ [{}], [{}] ], ids_l: [], ids_r: [], matr_h: 10}, side: "left" }
        const VOID = dat.void || 1;
        const OFFSET = 0;
        const TRIGGER = dat.aim_h + VOID; // 2 + 1 = 3
        let counter = OFFSET; //0
        const LR = (dat.side.startsWith("l")) ? ("ids_l") : ("ids_r");
        //const AIMS_COUNT = dat.dist_tool[LR].length || Math.floor( dat.matr_h/TRIGGER );
        const AIMS_COUNT = dat.dist_tool[LR].length || 0;
        // * fill vector of zeroes
        let vec = [];
        for (let i=0; i < dat.matr_h; i++) { vec[i] = 0 }
        //console.log("vec=", vec);
        for (let i=0; i < AIMS_COUNT; i++) {
            for (let j=0; j < dat.aim_h; j++) {
                vec[counter+j] = 1;
            }
            counter += TRIGGER;
        }

        return vec;
        //counter++;
        //if (TRIGGER % counter == TRIGGER) {counter = 1}
    }

    function create_pocket_aim_obj(dat)
    {
        // dat = {matr_h: 20, aim_h: 2, dist_tool: {dist_matr: [ [{}], [{}] ], ids_l: [], ids_r: [], matr_h: 10}, side: "left" }
        const VOID = dat.void || 1;
        let patt = [];
        for (let i=0; i < dat.aim_h; i++) {patt.push(1);}
        for (let i=0; i < VOID; i++) {patt.push(0);}
        //////console.log("patt="+patt);
        let res = [];
        const LR = (dat.side.startsWith("l")) ? ("ids_l") : ("ids_r");
        const AIMS_COUNT = dat.dist_tool[LR].length;
        let counter = 0;
        for (let i=0; i < AIMS_COUNT; i++) {
            let aim = {};
            aim.who_join = 0;
            aim.ord = (Number(i)+1);
            // * create property, which make collate with pocket.aims_vec
            aim.vec_vals = [];
            for (let j=0; j < (dat.aim_h + VOID); j++) {
                if (patt[j] == 1) { aim.vec_vals.push(counter); }
                counter++;
            }

            res.push(aim);
        }
        return res;
    }

    function create_pocket_aim_obj_2(dat)
    {
        // dat = {matr_h: 20, aim_h: 2, dist_tool: {dist_matr: [ [{}], [{}] ], ids_l: [], ids_r: [], matr_h: 10}, side: "left" }
        const VOID = dat.void || 1;
        let patt = [];
        for (let i=0; i < dat.aim_h; i++) {patt.push(1);}
        for (let i=0; i < VOID; i++) {patt.push(0);}
        //////console.log("patt="+patt);
        let res = {};
        const LR = (dat.side.startsWith("l")) ? ("ids_l") : ("ids_r");
        const AIMS_COUNT = dat.dist_tool[LR].length;
        let counter = 0;
        for (let i=0; i < AIMS_COUNT; i++) {
            let aim = {};
            aim.who_join = 0;
            // * create property, which make collate with pocket.aims_vec
            aim.vec_vals = [];
            for (let j=0; j < (dat.aim_h + VOID); j++) {
                if (patt[j] == 1) { aim.vec_vals.push(counter); }
                counter++;
            }

            let ord = (Number(i)+1);
            res[ord] = aim;
        }
        return res;
    }

}
//------------------------------------


//------------------------------------
// ----- SOLVING ONE COLUMN ----------
//------------------------------------
function solve_one_bar(arg)
{
    // * arg = {paths_matr: [[],[]], ord_matr: [[],[]], column: 1, dist_tool: {dist_matr:[[{}],[{}]], ids_l:[], ids_r:[],..}, pocket: {}, paths: {}, mid_xc: 6, for_side: "left"}
    let in_col_dots = [], dots_left = [], dots_right = [];
    let vpass = get_col_distrib({column: arg.column, mid_xc: arg.mid_xc, pocket: arg.pocket, dist_tool: arg.dist_tool, for_side: arg.for_side});

    // * pass throw all rows in one column and detect dots from lowest YC(max) to upside YC(0)
    if (vpass == "downup")
    {
        for (let row = arg.ord_matr.length-1; row >=0; row--) {
        // * pass throw all rows in one column and detect dots from up YC(0) to downside YC(max)
        //for (let row = 0; row < arg.ord_matr.length; row++) {

            if (arg.ord_matr[row][arg.column] > 0){
                in_col_dots.push(row);
                if (arg.dist_tool.dist_matr[row][arg.column].side == "left")
                    dots_left.push(row);
                else
                    dots_right.push(row);
            }
        }
    }
    else if (vpass == "updown")
    {
        //for (let row = arg.ord_matr.length-1; row >=0; row--) {
        // * pass throw all rows in one column and detect dots from up YC(0) to downside YC(max)
        for (let row = 0; row < arg.ord_matr.length; row++) {

            if (arg.ord_matr[row][arg.column] > 0){
                in_col_dots.push(row);
                if (arg.dist_tool.dist_matr[row][arg.column].side == "left")
                    dots_left.push(row);
                else
                    dots_right.push(row);
            }
        }
    }

    //----------------------------------------
    // * main part of function - sends a task to find a path for a single dot
    //----------------------------------------
    for (let row in in_col_dots)
    {
        // * Note: type of in_col_dots[row] == "string"
        let ord = arg.ord_matr[in_col_dots[row]][arg.column];
        const DOT_OBJ = arg.dist_tool.dist_matr[in_col_dots[row]][arg.column];
        
        // * here we are talking about a column that can contain both left and right DOTS at the same time
        if ( (arg.for_side =="left") && (DOT_OBJ.side == "left") )
        {
            let sod = solve_one_dot({ dot_: DOT_OBJ, ord_matr: arg.ord_matr, paths_matr: arg.paths_matr, pocket: arg.pocket, in_col_dots: in_col_dots, dots_same_side: dots_left, mid_xc: arg.mid_xc, dist_tool: arg.dist_tool});
            arg.paths[ ord ] = sod.path;
        }
        else if ( (arg.for_side =="right") && (DOT_OBJ.side == "right") )
        {
            let sod = solve_one_dot({ dot_: DOT_OBJ, ord_matr: arg.ord_matr, paths_matr: arg.paths_matr, pocket: arg.pocket, in_col_dots: in_col_dots, dots_same_side: dots_right, mid_xc: arg.mid_xc, dist_tool: arg.dist_tool});
            arg.paths[ ord ] = sod.path;
        }

        // * WRITE to PATHS MATR info about one dot PATH
        add_path_to_paths_matr({ paths_matr: arg.paths_matr, path: arg.paths[ord], ord: ord });
    }

    // * function decides how we will pass one column: from up to bottom or bottom to up
    function get_col_distrib(arg)
    {
        // * arg = {column: 3, mid_xc: 6, pocket: {}, dist_tool: {}, for_side: "left" }
        let vpass = "downup";
        //let side = (arg.column <= arg.mid_xc) ? ("left") : ("right");
        let for_side = arg.for_side;
        // * returns array of dots objects if in mid_xc there are both 'left' and 'right' dots or []
        let find_mid_dots = function() {
            let mid_dots = [];
            let is_left     = false,
                is_right    = false;
            if ( (for_side == "left") && (arg.column == arg.mid_xc) ) {
                for (let row in arg.dist_tool.dist_matr) {
                    let dot = arg.dist_tool.dist_matr[row][arg.mid_xc];
                    // * same 'if dot exist in this cell'
                    if (dot.ord) {
                        mid_dots.push(dot);
                        if (dot.side == "left") is_left = true;
                        else if (dot.side == "right") is_right = true;
                    }
                }
            }
            // So, return array only if it  contains both 'left' and 'right' dots
            if (is_left && is_right) return mid_dots;
            else return [];
        }
        // * returns number between (1 AND max(aims_) ) with 0.5 step, e.g. 1||1,5||2||...
        let find_dot_track = function(dot) {
            let aims_ = arg.pocket.aims_[for_side];
            // * FINDING TRACK
            let dot_track = 0;
            for (let i in aims_) {
                if (aims_[i].vec_vals.indexOf(dot.yc) > -1) {dot_track = Number(i)}  }
            // * OR IT MEANS THAT DOT IS BETWEEN TRACKS
            if (dot_track == 0) {
                for (let i in aims_) {
                    if (aims_[i].vec_vals.indexOf(dot.yc-1) > -1) {dot_track = Number(i) + 0.5}  }  }
            return dot_track;
        }
        // * returns array of free aims, considering and subtracting those that are forbidden to go to
        let find_free_aims_ords = function(dot) {
            let free_aims_ords = [];
            // choose aims in left or right pocket
            let aims_ = arg.pocket.aims_[dot.side];
            for (let i in aims_) {
                // * if Aim reserved for this special Dot, then only this Aim we are interested in and nothing else matter
                if (aims_[i].reserved) {
                    if (aims_[i].reserved.indexOf(dot.ord) > -1) {
                        free_aims_ords.push(Number(i));
                        break;  }  }
                if (aims_[i].who_join == 0) {
                    if (aims_[i].not_suitable_for) {
                        if (aims_[i].not_suitable_for.indexOf(dot.ord) == -1) {
                            // * it means that Aim is Upper than Dot and Dot must be on Top of Column
                            free_aims_ords.push(Number(i) );  }
                    } else { free_aims_ords.push(Number(i) ); }
                }
            }
            return free_aims_ords;
        }
        // * returns positive or negative score for dot, that makes the dot gravitate up or bottom
        let count_score_by_yc_level = function(dot_track, free_aims_ords){
            //console.log("count_score_by_yc_level: dot_track=",dot_track, ", free_aims_ords=",free_aims_ords);
            // * look for first free Aim and it height Mark by YC and compare with Dot YC
            let score = 0;
            const YC_level_price = 2;
            if (free_aims_ords.length > 0) {
                for (let i in free_aims_ords) {
                    let diff = Number(dot_track) - Number(free_aims_ords[i]);
                    // * score - how much the strength of gravitate to up or bottom
                    score += YC_level_price * diff * -1;
                }
            }
            return score;
        }
        // * Probably it will recombinate dots in the middle column, because it might be more convenient for them
        let recombinate_mid_dots = function(mid_dots){
            // * mid_dots = [{dot_object},{dot_object}, ...];
            // * clone array (Note: objects inside array are not clonned, but the same pointers)
            let sorted_mid_dots = mid_dots.slice(0) ;
            // * sides = ["left", "right", "right", ...]
            let sides = mid_dots.map(el=>{ return el.side; });
            // sort from min to max scores
            sorted_mid_dots.sort((a,b)=>{
                if (a.score < b.score) return -1;
                if (a.score > b.score) return 1;
                return 0;
            });
            // * sorted_sides = ["right", "right", "left", ...]
            let sorted_sides = sorted_mid_dots.map(el=>{ return el.side; });
            // * change sides for middle dots
            for (let i=0; i < mid_dots.length; i++) {
                mid_dots[i].side = sorted_sides[i];
            }
        }
        //---------------------------------
        //---------------------------------

        // * When went throw left half and came to mid_xc and mid_xc have dots with differents sides
        let mid_dots = find_mid_dots();
        //--------------------

        // * MAYBE REASSIGN DOTS IN THE MIDDLE
        if (mid_dots.length > 0) {
            // * if first 'left' dot (which on top of column) is upper than it's Aim
            // * then look for next 'right' dots in column the same goal
            // * if both of them need to, for example, be on top of column, then second competition
            // * for example, how much of free columns, moving to edge, have left or right

            // * let's start assigning scores to dots, who needs to be at the top more
            let score = 0, left_score = 0, right_score = 0;
            for (let i in mid_dots) {
                if (mid_dots[i].side == "left") {
                    // * get the first dot. It always will 'left' at start
                    mid_dots[i].score = 0;
                    let dot_track_acc_05 = find_dot_track(mid_dots[i]);
                    let free_aims_ords = find_free_aims_ords(mid_dots[i]);
                    mid_dots[i].score += count_score_by_yc_level(dot_track_acc_05, free_aims_ords);
                } else { mid_dots[i].score = 0; }
            }
            recombinate_mid_dots(mid_dots);
        }
        //--------------------

        // * ---- 1) calc avg of ord numbers of all free aims
        let free_aims_sum = 0;
        let free_aims_counter = 0;
        let aims_ = arg.pocket.aims_[for_side];
        for (let i in aims_) {
            // * keys can be: not_suitable_for, who_join, reserved
            if (aims_[i].who_join == 0) {
                free_aims_sum += Number(i);
                free_aims_counter++;            }        }
        let free_aims_avg = (free_aims_counter == 0) ? 0 : (free_aims_sum / free_aims_counter);

        // * ---- 2) calc avg of ord numbers of tracks, for which dots in column are nearest
        let dots_sum = 0;
        let dots_counter = 0;
        for (let row in arg.dist_tool.dist_matr) {
            let dot = arg.dist_tool.dist_matr[row][arg.column];
            if (dot.ord) {
                let dot_track = find_dot_track(dot);
                dots_sum += dot_track;
                dots_counter++;            }        }
        let dots_avg = (dots_counter == 0) ? 0 : (dots_sum / dots_counter);

        // * ---- 3) biggest will define vert or hor pass of column
        if (free_aims_avg > dots_avg) vpass = "updown";
        if (dots_avg > 0)
            //console.log("dots_avg=", dots_avg, ", free_aims_avg=",free_aims_avg, ", vpass=",vpass, ", for_side=", for_side);



        return vpass;
    }

}
//-------------------------------------


//------------------------------------
// --------- GETTING RESULT ----------
//------------------------------------
function add_path_to_paths_matr(arg)
{
    // * arg = {paths_matr: [[],[]], path = [[x1,y1], [x2,y2]], ord: 3 }
    ////console.log("aptpm: arg=", JSON.stringify(arg));
    if (arg.path)
    {
        if (arg.path == "fail") { return; }
        else
        {
            for (let i = 0; i < arg.path.length; i++) {
                let xc = arg.path[i][0], yc = arg.path[i][1];
                arg.paths_matr[yc][xc] = arg.ord;
            }
        }
    }
}
//-------------------------------------


//------------------------------------
//------------- GET DOT PATH ---------
//------------------------------------

function FDP_Chainer(arg){
    this.funcs = {
        f1: get_dot_pos_rel_aim,
        f2: check_aim_on_track_busy,
        f3: find_next_free_aim,
        f4: find_dot_path,
    };
    this.all_args = arg;
    this.add_args = function(add_arg) {
        Object.assign(this.all_args, add_arg);
    }
    this.args = {
        f1: { dot_: arg.dot_, pocket: arg.pocket, ord_matr: arg.ord_matr, paths_matr: arg.paths_matr },
    };
    this.launch = function(arr) {
        for (let i in arr) {
            this.funcs[arr[i]](this.args[arr[i]]);
        }
    }
}

function solve_one_dot(arg)
{
	// arg = {dist_tool: { dist_matr: [ [{}], [{}] ], ids_l: [], ids_r: [] }, dot_ord: 5, dot_:{id: 1200, xc: 3, yc: 7}, ord_matr: [[],[]], paths_matr: [[],[]], pocket: { aims_vecs: {left:[], right:[]}, aims_objs: {left:[], right:[]}, in_col_dots: [y7,y4,y2], dots_same_side: [y7], mid_xc: 6, dist_tool:{dist_matr:[], ids_l }

    GOB.chainer = new FDP_Chainer(arg);

    // * arg.dot_.loc ={rel: "on_track" || "between_tracks" || "under_lowest", dest: 3 }
	arg.dot_.loc = get_dot_pos_rel_aim({ dot_: arg.dot_, pocket: arg.pocket, ord_matr: arg.ord_matr, paths_matr: arg.paths_matr });

    // * if AIM we want to go to IS FREE
    let is_aim_busy = check_aim_on_track_busy({pocket: arg.pocket, dot_: arg.dot_ });
    if (is_aim_busy)
    {
        // * Note: we introduce new state of dot position relative to track
        arg.dot_.loc.rel = "target_set";
        // * if aim on this track is busy, then try to get one above, then below, and so alternate
        arg.dot_.loc.dest = find_next_free_aim( { dot_: arg.dot_,  pocket: arg.pocket } );
        //console.log("2) AIM IS BUSY. NEW AIM IS:", arg.dot_.loc.dest);
    }

    let dotres;
    if (arg.dot_.loc.dest) {
        let args = { dot_: arg.dot_,  paths_matr: arg.paths_matr, ord_matr:arg.ord_matr, pocket: arg.pocket,  in_col_dots: arg.in_col_dots,  dots_same_side: arg.dots_same_side,  mid_xc: arg.mid_xc }
        dotres = find_dot_path(args);
    } else { dotres = {}; dotres.path = []; }

    return dotres;
}

//_____________________¶
//______________________¶
//__________________¶__¶
//_________________¶__¶
//________________¶___¶
//________________¶____¶
//__________________¶____¶
//___________________¶___¶
//___________________¶__¶
//______________¶¶¶¶¶¶¶¶¶¶¶
//__________¶¶¶¶¶¶_______¶¶¶¶¶¶
//________¶¶¶¶_______________¶¶¶¶
//_______¶¶¶___________________¶¶¶
//_______¶¶_____________________¶¶
//_______¶¶¶¶¶______________¶¶¶¶¶¶¶¶¶¶¶
//______¶¶__¶¶¶¶¶¶_______¶¶¶¶¶¶__¶¶___¶¶
//______¶¶______¶¶¶¶¶¶¶¶¶¶¶______¶¶___¶¶
//___¶¶_¶¶_______________________¶¶¶¶¶¶
//_¶¶¶¶_¶¶________¶¶¶_¶¶¶________¶¶_¶¶¶¶¶
//¶¶¶¶¶_¶¶_______¶¶¶¶¶¶¶¶¶_______¶¶_¶¶¶¶¶
//¶¶¶¶¶_¶¶_______¶¶¶¶¶¶¶¶¶_______¶¶_¶¶¶¶¶
//¶¶¶¶¶¶_¶¶_______¶¶¶¶¶¶¶_______¶¶_¶¶¶¶¶¶
//¶¶¶¶¶¶¶_¶¶________¶¶¶_______¶¶_¶¶¶¶¶¶¶
//_¶¶¶¶¶¶¶¶_¶¶_______¶_______¶¶_¶¶¶¶¶¶¶¶
//___¶¶¶¶¶¶¶¶_¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶_¶¶¶¶¶¶¶¶
//_____¶¶¶¶¶¶¶_______________¶¶¶¶¶¶¶
//_______¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶
//_________¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶
//____________¶¶¶¶¶¶¶¶¶¶¶¶¶¶¶

function find_dot_path(args)
{
    // * args = {  dot_: {},  paths_matr: [[],[]], ord_matr: [[],[]], pocket: {},  in_col_dots: [],  dots_same_side: [],  mid_xc: 6 }
    // * dot_ = {"id":52,"xc":13,"yc":2,"ord":5,"arrived":false,"side":"right","loc":{"rel":"between_tracks","dest":2}}
    let dotres = {};
    args.dot_.path = {};
    args.dot_.env = {};
    dotres.path = [];
    let side = args.dot_.side;

    // * --------- 1. FIRST PART - FIND VERTICAL PATH TO TRACK -----------
    // * path.vpart = {msg: "done" || "shift_aim", res: [] || {reserved:[], count: 5} }
    args.dot_.path.vpart = find_vert_path_to_track(args);
    //console.log("args.dot_.path.vpart=",args.dot_.path.vpart);
    // * -----1.1. CHECK IF VERT PATH IS OK -------------
    if (args.dot_.path.vpart.msg == "fail") {
        //console.log("Can't find DOT Path !");
        args.dot_.path.msg == "fail vpart";
        return dotres;
        // * TODO: THERE SHOULD BE NO UNSOLVABLE SITUATIONS
    }

    // * if (msg == "shift_aim") then this dot needs to assign to next aim
    // * means that the DOT moved to the depth of the grid to get around the obstacle and could block some dots which not arrived yet
    if (args.dot_.path.vpart.msg == "shift_aim")
    {
        console.log("shift_aim!");
        // * reserving AIM, adding spec property. Now DOTs will look for this prop and ask can it welcome
        //args.pocket.aims_[side][args.dot_.loc.dest].reserved = vert_path_to_track.res.reserved;
        args.pocket.aims_[side][args.dot_.loc.dest].reserved = args.dot_.path.vpart.res.reserved;

        // * TODO: TEMPORARY STRING BELOW MUST BE DELETED
        let dot_vdir = get_dot_vdir( {dot_: args.dot_, pocket: args.pocket} );
        //console.log("5.2) count=", vert_path_to_track.res.count);

        args.dot_.loc.dest_prev = args.dot_.loc.dest;
        if (dot_vdir == "down")
            args.dot_.loc.dest = args.dot_.loc.dest + args.dot_.path.vpart.res.count;
        else
            args.dot_.loc.dest = args.dot_.loc.dest - args.dot_.path.vpart.res.count;

        if (args.dot_.loc.dest == 0) {
            // * TODO: if we wanted to concede an Aim based on the principle of mini-matrices, but went beyond the numbering of Aims
            // * intuitively, it seems that this can lead to unpredictable results, because we have mixed two different strategies
            args.dot_.loc.dest = 1;
            // * so, if a Dot went to a Aim and then had to give up that Aim to another Dot, but this Aim was First or Last in pocket, then mark this Aim not suitable for this Dot and let's find another Aim for this Dot.
            args.pocket.aims_[side][args.dot_.loc.dest].not_suitable_for = [];
            args.pocket.aims_[side][args.dot_.loc.dest].not_suitable_for.push(args.dot_.ord);

            args.dot_.loc.dest = find_next_free_aim( { dot_: args.dot_,  pocket: args.pocket } );
        }
        else if ( (args.dot_.loc.dest < 0) || (args.dot_.loc.dest > GOB.MAX_AIMS/2 ) )
        {
            // * It means that, probably, more than one dot were catched by mini-matrix
            if (args.dot_.loc.dest < 0) {
                let passed_count = args.dot_.path.vpart.res.count;
                for (let i = args.dot_.loc.dest_prev; i > 0; i--) {
                    ////console.log("!!!TODO!!!", i);
                    args.pocket.aims_[side][i].not_suitable_for = [];
                    args.pocket.aims_[side][i].not_suitable_for.push(args.dot_.ord);
                    args.dot_.loc.dest = find_next_free_aim( { dot_: args.dot_,  pocket: args.pocket } );
                }
            }
            else if (args.dot_.loc.dest > GOB.MAX_AIMS/2) {
                let passed_count = args.dot_.path.vpart.res.count;
                for (let i = args.dot_.loc.dest_prev; i <= GOB.MAX_AIMS/2; i++) {
                    //console.log("!!!TODO!!!", i);
                    args.pocket.aims_[side][i].not_suitable_for = [];
                    args.pocket.aims_[side][i].not_suitable_for.push(args.dot_.ord);
                    args.dot_.loc.dest = find_next_free_aim( { dot_: args.dot_,  pocket: args.pocket } );
                }
            }


            //return dotres;
            // * WE MUST MARk All the Aims, which were passed, as 'not_suitable_for', as example below
        }
        // * chage DOT property, which instruct the point where it should GO
        if ( (args.dot_.loc.dest > 0) && (args.dot_.loc.dest <= GOB.MAX_AIMS/2 ) )
            args.dot_.path.vpart = find_vert_path_to_track(args);
    }

    // * --------- 2. SECOND PART - FIND HORIZONTAL PATH TO AIM -----------
    if ( (args.dot_.loc.dest <= 0) && (args.dot_.loc.dest > GOB.MAX_AIMS/2 ) ) return dotres;
    else {   
        let args_2 = { dot_: args.dot_,  paths_matr: args.paths_matr,  path_part: args.dot_.path.vpart.res  };
        let hor_path_to_edge = look_edge_line_free(args_2);
        if (hor_path_to_edge.free)
        {
            // * compound full path
            dotres.path = dotres.path.concat(args.dot_.path.vpart.res) ;
            dotres.path = dotres.path.concat(hor_path_to_edge.coord_line) ;
    
            // * make aim is busy !
            args.dot_.arrived = true;
            args.pocket.aims_objs[side][args.dot_.loc.dest-1].who_join = args.dot_.ord;
            args.pocket.aims_[side][args.dot_.loc.dest].who_join = args.dot_.ord;
            // * add to Global Object ordernumber of Dot, which find own path
            GOB.ready_dots.push(args.dot_.ord);
        }
        else {
            console.log("can't find path for dot:", args.dot_.ord);
        }
    }
    return dotres;
}

function find_dot_path_v2(arg, charg)
{
    //* arg = {  dot_: {},  paths_matr: [[],[]], ord_matr: [[],[]], pocket: {},  in_col_dots: [],  dots_same_side: [],  mid_xc: 6 }
    let concatenate_paths = function(vpath, hpath) {
        //* path = [[x1,y1],[x2,y2]]
        return [];
    }
    // ------- IMPL ---------
    let dot_info = GOB.dots[arg.dot_.ord];
    if (!dot_info) { GOB.dots[arg.dot_.ord] = {}; }

    arg.parent1 = find_dot_path_v2;
        
    if (arg.vpath) { dot_info.vpath = Object.assign(dot_info.vpath, arg.vpath); }
    if (arg.hpath) { dot_info.hpath = Object.assign(dot_info.hpath, arg.hpath); }
        
    if (dot_info.vpath) {   
        if (dot_info.vpath.done) {
            if (dot_info.hpath) {
                if (dot_info.hpath.done) {
                    return concatenate_paths(dot_info.vpath.path, dot_info.hpath.path);
                } 
                else if (!dot_info.hpath.done){ console.log("can't find dot hpath"); }    
            }
            else if (!dot_info.hpath) { find_dot_hpath_v2(arg); } 
        } 
        else if (!arg.vpath.done) {
            if (arg.vpath.msg = "edge_overshift") {   
                arg.shift_hdir = "depth";
                find_dot_vpath_v2(arg);
            }
            else console.log("an unknown crap, when finding edge shift"); 
        }
    } else if (!arg.vpath) {
        arg.shift_hdir = "edge";
        find_dot_vpath_v2(arg);
    }

}

function find_dot_vpath_v2(arg)
{
    let result = {};

    if (arg.shift_hdir == "edge") {
        //* initial pre shift, cause need to step towards the edge for other dots good exodus
        const shift_and_vdir = get_vdir_and_init_shift(arg); 
        //* result now = {shift: 1, v_dir: "up", is_edge_overshift: false}
        result = Object.assign(result, shift_and_vdir);
        
        if (result.is_edge_overshift) { result.done = false; result.msg = "edge_overshift"}
        else {
            let edge_shift = recursive_shifter(arg);
            // * result add props = {done: false, vpath: [], msg: "edge_overshift"}
            //* NOTE: second argument will Win and Rewrite props with the same names
            result = Object.assign(result, edge_shift);
        }
    }
    else if (arg.shift_hdir == "depth") {

    }
    
    
    // calling parent function with result
    if(arg.parent1) arg.parent1(arg, {vpath: result});
    else {console.log("no parent in find_dot_vpath_v2()");}
}

function find_dot_hpath_v2(arg)
{
    let result = {};
    arg.parent({child: {has_vpath_found: true}});
    

    if(arg.parent1) arg.parent1(arg, {vpath: result});
    else {console.log("no parent in find_dot_hpath_v2()");}
}


// * ----------------------------------------
//-------1-st PART FIND VERT PATH TO TRACK---
// * idea of this function is to find good free vertical path for dot, which will allows get out to necessary track
// * ---------------------------------------
function find_vert_path_to_track(arg)
{
    // * arg = {path: path, dot_: arg.dot_, paths_matr: arg.paths_matr, pocket: arg.pocket, in_col_dots: [y7,y4,y2], dots_same_side: [y7], mid_xc: 6 }
    // * also may be property: 'dot_.loc.dest' and maybe 'mm_strat' = true
    // * adds vertical part of the path which taxi to aim track
    let vpath_info = {};
    // * this function calculate optimal dot vertical path shift depend on how much other dots are present in this column and where they want to go
    let get_vdir_and_init_shift = function(arg)
    {
        // * arg = { in_col_dots: [y7,y4,y2], dots_same_side: [y7], dot_: {xc:7, yc:0, id: 1200, side: 'left'}, pocket: {aim_objs_2: {left: {3: {who_join: 2, vec_vals:[3,4]} } } }, paths_matr: [[],[]] }
        // * 'init shift' - calculate initial shift based on how much dots are present in same column, which are cause to make shift beforehand
        let define_dot_vdir = function(vec_vals){
            let vdir = "none";
            // * it means that dot located higher than upper boundary of the target, accordingly dot need to move down
            if (vec_vals[0] > arg.dot_.yc) { vdir = "down"; }
            ////console.log("calc_shift: dot direct down");
            // * it means that dot located lower than the lowest border of aim, so dot need to move up
            else if (vec_vals[vec_vals.length - 1] < arg.dot_.yc) { vdir = "up"; }
            ////console.log("calc_shift: dot direct up");
            return vdir;
        }
        let init_shift = function(side, v_dir, vec_vals, otherside_dots){
            // * ------ INIT SHIFT CALCULATING -------
            let shift = 0;
            if (side == "left") {
                if (v_dir == "down") {
                    // * e.g. dot on 5 YC and Aim is on 9 YC, then y = 6,7,8,9
                    for (let y = arg.dot_.yc + 1; y <= vec_vals[0]; y++) {
                        if (arg.dots_same_side.indexOf(y) > -1) shift--;
                        if (otherside_dots.indexOf(y) > -1) { shift--; }  }  }
                else if (v_dir == "up") {
                    // * e.g. dot on 8 YC and Aim's lowest border is on 4 YC, then y = 7,6,5,4
                    for (let y = arg.dot_.yc - 1; y >= vec_vals[1]; y--) {
                        if (arg.dots_same_side.indexOf(y) > -1) shift--;
                        if (otherside_dots.indexOf(y) > -1) { shift--; }  }  }  }
            else if (side == "right") {
                if (v_dir == "down") {
                    // * e.g. dot on 5 YC and Aim is on 9 YC, then y = 6,7,8,9
                    for (let y = arg.dot_.yc + 1; y <= vec_vals[0]; y++) {
                        if (arg.dots_same_side.indexOf(y) > -1) shift++;
                        if (otherside_dots.indexOf(y) > -1) { shift++; }  }  }
                else if (v_dir == "up") {
                    // * e.g. dot on 8 YC and Aim lowest border is on 4 YC, then y = 7,6,5,4
                    for (let y = arg.dot_.yc - 1; y >= vec_vals[1]; y--) {
                        if (arg.dots_same_side.indexOf(y) > -1) shift++;
                        if (otherside_dots.indexOf(y) > -1) { shift++; }  }  }   }
            return shift;
            // * -----------------------------
        }
        //-----------IMPL---------------
        let res = {};
        res.shift = 0;
        let side = arg.dot_.side;
        let target_aim = arg.dot_.loc.dest ;
        //console.log("target_aim=",target_aim);
        let vec_vals = arg.pocket.aims_[side][target_aim].vec_vals;
        // * res.v_dir == "none" || "up" || "down"
        res.v_dir = define_dot_vdir(vec_vals);
        // * now, when we know dot vertical direction, we must calculate how much of other dots are present in same column on the relevant way
        // * array like [y4, y2] of dots, which will go to other side than the current dot
        let otherside_dots = DiffArrays(arg.in_col_dots, arg.dots_same_side);
        // * distance from dot YC position to Aim's YC position
        let v_dist;
        //let only_once = true;
        res.shift = init_shift(side, res.v_dir, vec_vals, otherside_dots);
        // * --- ASK does this SHIFT go OVER the EDGE of the grid ? ---
        let dot_edge_dist = (side == "left") ? (arg.dot_.xc) : (arg.paths_matr[0].length - 1 - arg.dot_.xc);
        // * next string of code determines that the shift is greater than edge allows
        if (Math.abs(res.shift) > dot_edge_dist)  {
            res.edge_overshift = true;
            // * make recommended shift like first inversed column
            //res.shift = (side == "left") ? (1) : (-1) ;
        }
        // * ------------------------

        // * now check if shift exist, but we already on edge, then we are shit in pants
        // * if not undefined order number of concrete aim, where current dot must be pass
        //if (arg.dot_.loc.dest) {        }
        // * how much of dots are present above current dot in current column.
        //let dots_above = arg.in_col_dots.length - arg.in_col_dots.indexOf(arg.dot_.yc) - 1;
        // * desired shift is such, that he is depend on how much dots are present above current dot in current column
        //arg.shift = (arg.dot_.side == 'left') ? arg.dots_above * -1 : arg.dots_above;
        //if( (arg.shift < 0) && (arg.dot_.xc == 0) ) arg.shift = 0;

        return res;
    }
    let recursive_shifter = function(arg)
    {
         // * arg = { path: path, dot_: arg.dot_, paths_matr: arg.paths_matr, pocket: arg.pocket, in_col_dots: [y7,y4,y2], dots_same_side: [y7], shift: 2, v_dir: "up", edge_overshift: true }
        // * it returns a flat vertical line that coincides with a Dot in the XC coordinate And it's YCmin = Dot.yc(+-)1 And YCmax = the Track of the Aim
        vpath_info.res = get_dot_init_vpath_with_shift({ path: arg.path, dot_: arg.dot_, paths_matr: arg.paths_matr, pocket: arg.pocket, shift: arg.shift, v_dir: arg.v_dir});

        // * if moving in depth and have big shift, we must check column with XC = (dot_pos+shift-1)
        if ( (arg.h_dir == "depth") && (Math.abs(arg.shift) > 1) ) {    }

        // * check this vertical path for obstacles = {is_obstacles: true, arr: []}
        let obstacles = check_path_part_for_obstacles({path_part: vpath_info.res, paths_matr: arg.paths_matr, dot_: arg.dot_ });

        // * some differences depend on side
            // * h_dir gets into recursion from the top layer of the function stack and the recursion will be completed when we get to the edge or to the depth
        if (arg.dot_.side == "left") {
            arg.shift = (arg.h_dir == "edge") ? (arg.shift - 1) : (arg.shift + 1);
            arg.shift_lim = (arg.h_dir == "edge") ? (arg.dot_.xc) : (arg.mid_xc - arg.dot_.xc);
        }
        else if (arg.dot_.side == "right") {
            arg.shift = (arg.h_dir == "edge") ? (arg.shift + 1) : (arg.shift - 1);
            arg.shift_lim = (arg.h_dir == "edge") ? (arg.paths_matr[0].length - arg.dot_.xc - 1) : (arg.dot_.xc - arg.mid_xc);
        }

        // * if there is obstacles, then start recursive function, which find free path
        if (obstacles.is_obstacles) {
            // * if obstacle in a same hor line, at this moment we will stop recursion, because complexity of this route more than 2 elbows
            if (obstacles.is_obstacle_on_same_hor_line) { arg.was_path_found = false; return; }
            if(Math.abs(arg.shift) <= Math.abs(arg.shift_lim))  {
                recursive_shifter(arg);
            }

        }
        else { arg.was_path_found = true; vpath_info.msg = "done"; return; }
    }
    let mark_overlapped_dots = function(arg)
    {
        // * arg = {reserved: []}
        ////console.log("reserved=", arg.reserved);
        for (let i in arg.reserved) {
            GOB.dots[arg.reserved[i]].overlaped = true;
        }
        ////console.log("GOB dots=", JSON.stringify(GOB.dots));
    }
    let count_overlapped_dots = function(arg)
    {
        // * arg = {shift: -2, v_dir: 'up', dot_: {}, ord_matr: [[],[]], vert_path: vpath_info}
        ////console.log("count_overlapped_dots() -> vert_path=", JSON.stringify(arg.vert_path);

        // * if current dot route was laid in depth, it could overlap other dots, so we check for such dots
        // * META: from X1,Y1 to Xn,Yn look for dots ord_matr, which is not arrived yet
        // * X1 = dot.xc+1; Xn = dot.xc+shift; Y1 = dot.yc; Yn = vpath_info.tail
        let res = {};
        res.reserved = [];
        res.count = 0;
        let x0, y0, xn, yn;

        // * PART 1: Depend on: a) 'up' or 'down' v_dir of dot b) 'left' or 'right' side
        // *        set up start and end coordinates for mini-matrix to scan for dots, which could be overlapped
         if (arg.dot_.side == "left")
        {
            if (arg.v_dir == 'down') {
                x0 = arg.vert_path[0][0];
                y0 = arg.vert_path[0][1];
                xn = arg.vert_path[arg.vert_path.length-1][0];
                yn = arg.vert_path[arg.vert_path.length-1][1];
            }
            else if (arg.v_dir == 'up') {
                x0 = arg.dot_.xc;
                y0 = arg.vert_path[arg.vert_path.length-1][1];
                xn = arg.vert_path[arg.vert_path.length-1][0];
                yn = arg.dot_.yc ;
            }
        }
        else if (arg.dot_.side == "right")
        {
            if (arg.v_dir == 'down') {
                x0 = arg.vert_path[arg.vert_path.length-1][0] + 1;
                y0 = arg.dot_.yc + 1;
                xn = arg.dot_.xc;
                yn = arg.vert_path[arg.vert_path.length-1][1];
            }
            else if (arg.v_dir == 'up') {
                x0 = arg.vert_path[arg.vert_path.length-1][0] + 1;
                y0 = arg.vert_path[arg.vert_path.length-1][1];
                xn = arg.dot_.xc - 1;
                yn = arg.dot_.yc - 1;
            }
        }
        //console.log("x0=",x0,", y0=",y0,", xn=",xn,", yn=",yn);
        // * PART 2: pass throught mini-matrix and count overlapped DOTS.
        // *
        for (let row = y0; row < yn; row++)
        {
            for (let col = x0; col < xn; col++)
            {
                let dot_ord = arg.ord_matr[row][col];
                if (dot_ord > 0)
                {
                    if (GOB.dots[dot_ord].overlaped) continue;
                    if (GOB.dots[dot_ord].arrived) continue;
                    else {
                        res.count++;
                        res.reserved.push( dot_ord );
                    }
                }
            }
        }

        return res;

    }
    let init_depth_shift = function(arg)
    {
        // * arg = {}
        let res = {};

        arg.shift = (arg.dot_.side == "left") ? (1) : (-1) ;

        let side = arg.dot_.side;
        let target_aim = arg.dot_.loc.dest;
        let vec_vals = arg.pocket.aims_[side][target_aim].vec_vals;

        // * v_dir HELPS to Understand, how many of other dots, can meet current dot on his way
        res.v_dir = "none"; // * "none" || "up" || "down"
        // * it means that dot located higher than upper boundary of the target, accordingly dot need to move down
        if (vec_vals[0] > arg.dot_.yc) { res.v_dir = "down"; }////console.log("calc_shift: dot direct down");
        // * it means that dot located lower than the lowest border of aim, so dot need to move up
        else if (vec_vals[vec_vals.length - 1] < arg.dot_.yc) { res.v_dir = "up"; } ////console.log("calc_shift: dot direct up");

        // * SO, in contrast to calculating shift moving to edge, now shift already at least one more by XC in depth
        // * and we will look on this shifted column to: a) presence of obstacles b) additional calculation whether the shift is still needed, because maybe there are many dot's in this column. c) at the same time do not forget that we are limited by the depth boundary

        // * now, when we know dot direction we must calculate how much of other dots are present in same column on the relevant way
        //let otherside_dots = DiffArrays(arg.in_col_dots, arg.dots_same_side); // array like [y4, y2] dots which will go to other side than the current dot
        let depth_dist; // * distance from dot YC position to Depth limit by YC position
        let only_once = true;

        // * -- SHIFT CALCULATING ---
        if (side == "left")
        {
            if (res.v_dir == "down") {
                // * e.g. dot on 5 YC and Aim is on 9 YC, then i = 6,7,8,9
                for (let y = arg.dot_.yc + 1; y <= vec_vals[0]; y++) {
                    if (arg.dots_same_side.indexOf(y) > -1) res.shift--;
                    if ( (otherside_dots.indexOf(y) > -1) && (only_once) ) {
                        res.shift--;
                        only_once = false;
                    }
                }
            }
            else if (res.v_dir == "up") {
                // * e.g. dot on 8 YC and Aim lowest border is on 4 YC, then i = 7,6,5,4
                for (let y = arg.dot_.yc - 1; y >= vec_vals[1]; y--) {
                    if (arg.dots_same_side.indexOf(y) > -1) res.shift--;
                    if ( (otherside_dots.indexOf(y) > -1) && (only_once) ) {
                        res.shift--;
                        only_once = false;
                    }
                }
            }
        }
        else if (side == "right")
        {
            if (res.v_dir == "down") {
                // * e.g. dot on 5 YC and Aim is on 9 YC, then i = 6,7,8,9
                for (let y = arg.dot_.yc + 1; y <= vec_vals[0]; y++) {
                    if (arg.dots_same_side.indexOf(y) > -1) res.shift++;
                    if ( (otherside_dots.indexOf(y) > -1) && (only_once) ) {
                        res.shift++;
                        only_once = false;
                    }
                }
            }
            else if (res.v_dir == "up") {
                // * e.g. dot on 8 YC and Aim lowest border is on 4 YC, then i = 7,6,5,4
                for (let y = arg.dot_.yc - 1; y >= vec_vals[1]; y--) {
                    if (arg.dots_same_side.indexOf(y) > -1) res.shift++;
                    if ( (otherside_dots.indexOf(y) > -1) && (only_once) ) {
                        res.shift++;
                        only_once = false;
                    }
                }
            }
        }
        // * ------------------------

        // * --- ASK does this SHIFT go OVER the EDGE of the grid ? ---
        let dot_edge_dist = (side == "left") ? (arg.dot_.xc) : (arg.paths_matr[0].length - 1 - arg.dot_.xc);

        // * next string of code determines that the shift is greater than edge allows
        if (Math.abs(res.shift) > dot_edge_dist)  {
            // * overshift says how much cells we get over the grid
            res.edge_overshift = true;
            // * make recommended shift like first inversed column
            res.shift = (side == "left") ? (1) : (-1) ;
        }
        // * ------------------------


        // * now check if shift exist, but we already on edge, then we are shit in pants

        // * if not undefined order number of concrete aim, where current dot must be pass
        //if (arg.dot_.loc.dest) {        }
        // * how much of dots are present above current dot in current column.
        //let dots_above = arg.in_col_dots.length - arg.in_col_dots.indexOf(arg.dot_.yc) - 1;
        // * desired shift is such, that he is depend on how much dots are present above current dot in current column
        //arg.shift = (arg.dot_.side == 'left') ? arg.dots_above * -1 : arg.dots_above;

        //if( (arg.shift < 0) && (arg.dot_.xc == 0) ) arg.shift = 0;

        //return shift;
        return res;
    }
    let get_dot_init_vpath_with_shift = function(arg)
    {
        // * arg = {path: [[x1,y1],[x2,y2]], paths_matr:[[],[]], dot_: {}, shift:0}
        let res = [];
        if (arg.dot_.loc.rel == "on_track") { return res; }

        // * if same vert line, then path begin with (yc - 1) coord, that goal is except dot self
        // * but if there is shift to left or right for vert line, then dot level is included
        let start_coord = -1;
        if (arg.v_dir) {
            if (arg.v_dir == "down") start_coord = 1;
            else if (arg.v_dir == "up") start_coord = -1;
        }
        let YC = (arg.shift != 0) ? (arg.dot_.yc) : (arg.dot_.yc + start_coord);
        //YC = (YC < 0) ? 1 : YC;
        ////console.log("appdop: YC=", YC);

        if (arg.shift > 1) {
            for (let x = arg.dot_.xc + 1; x < arg.dot_.xc + arg.shift; x++) {
                let one_coord = [];
                one_coord.push(x, YC);
                res.push(one_coord);
            }
        }

        // * now we have some info about dot position relative to track

		if (arg.dot_.loc.rel == "between_tracks")
        {
            let one_coord = [];
            one_coord.push(arg.dot_.xc + arg.shift, YC);
            res.push(one_coord);
        }
        else if (arg.dot_.loc.rel == "under_lowest")
        {
            // * get vpath from dot, which locate is under lowest aim
            // * find last 1 in vector array, which looks like [1,1,0,1,1,0,..]
            let latest_vec_one = arg.pocket.aims_vecs[arg.dot_.side].lastIndexOf(1);
            // * compound path from dot to lowest aim
            for (let i= YC; i >= latest_vec_one; i--) {
                let one_coord = [];
                one_coord.push(arg.dot_.xc + arg.shift, i);
                res.push(one_coord);
            }
        }
        else if (arg.dot_.loc.rel == "target_set")
        {
            let side = arg.dot_.side;
            let vv = arg.pocket.aims_[side][arg.dot_.loc.dest].vec_vals;
            //next_aim_ord
            let start_path = YC, step = 0;
            // * previous aim that was the dest to current dot was busy, so now this newfree aim is exactly not on equal Y coord
            // * move down
            if (vv[0] > YC) { step = 1; }
            // * move up
            else { step = -1; }
            for (let i = start_path; i != vv[0]; i += step ) {
                let one_coord = [];
                one_coord.push(arg.dot_.xc + arg.shift, i);
                res.push(one_coord);
            }
            // * adding last point of path
            let one_coord = [];
            one_coord.push(arg.dot_.xc + arg.shift, vv[0]);
            res.push(one_coord);
        }
        else { }////console.log("warning: can't define dot_pos_rel_track");

        return res;
    }

    // * ---- GET INITIAL SHIFT ----------
    let args = {
        in_col_dots: arg.in_col_dots, // count of all dots in current column
        dots_same_side: arg.dots_same_side, // from them, those that intended to the same side
        dot_: arg.dot_, // {xc:5, yc:0, id:1200, side:"left"}
        pocket: arg.pocket, // {}
        paths_matr: arg.paths_matr, // [[],[]]
    };
    let shift_and_vdir = get_vdir_and_init_shift(args);
    //-------------------------------
    vpath_info = Object.assign(vpath_info, shift_and_vdir);
    arg.shift = shift_and_vdir.shift;
    arg.v_dir = shift_and_vdir.v_dir;
    arg.edge_overshift = shift_and_vdir.edge_overshift;
    arg.was_path_found = false;
    let is_edge_achieved = false;
    let is_deep_achieved = false;

    // * at the beginning we try to find any vertical strip to the track, constantly shifting to the edge, so strip, strip , strip,... And at the end we can get to the Edge of the grid
    if (!arg.edge_overshift) {
        arg.h_dir = "edge";
        recursive_shifter(arg);
    }
    // * if there is no good vertical strip(path) when moving to edge, so now try to find the same thing, by moving to depth
    if (!arg.was_path_found)
    {
        //console.log(pref,"SHIFTING TO DEPTH");

        // * -----------INIT SHIFT IN DEPTH ----------------
        //arg.shift = init_depth_shift(args);
        // * simplified shift initializationin depth: drop shift to first cell by XC in depth after the dot position. Different for the left and right sides.
        arg.shift = (arg.dot_.side == "left") ? (1) : (-1) ;
        // * --------------------------------------------------

        arg.h_dir = "depth";
        // * Now make recursively finding the good vert path moving by depth
        recursive_shifter(arg);
        //console.log(pref, "shift=",  arg.shift);
        //console.log(pref, "vpath_info=", vpath_info.res);
        if (!arg.was_path_found) {
            // * IF FAIL AGAIN, so there are NO EASY ROUTES
            //console.log(pref, "could not find good path for dot:", arg.dot_.ord);
            is_deep_achieved = true;
            vpath_info.msg = "fail";
            // * TODO: Additionally, we need to extract information about whether there were OVERLAPPING DOTS.
            // * And if there were, then add an additional vertical path to the new track with checking for obstacles
        }
        else {
            // * OK, here, we find vert path to track, and we find it deeper than dot xc position
            // * so, there is one IMPORTANT thing: if (Math.abs(arg.shift) > 1) then we must check for OVERLAPPING DOTS
            if (Math.abs(arg.shift) > 1)  {
                //console.log(pref, "SHIFT MORE THAN 1");
                // TODO: look if we overlap other dots, then we must to: 1) pass control to overlapped dot or 2) set target to next aim and accordinly recalculate vert path to track
                let overlap_dots = count_overlapped_dots({shift: arg.shift, v_dir: arg.v_dir, dot_: arg.dot_, ord_matr: arg.ord_matr, vert_path: vpath_info.res});
                if (overlap_dots.count > 0) {
                    mark_overlapped_dots({reserved: overlap_dots.reserved });
                    //arg.overlap_once = false;
                    vpath_info.msg = "shift_aim";
                    vpath_info.res = overlap_dots;
                }
            }
            // * IMPORTANT TO CHANGE
            else { vpath_info.msg = "done"; }
        }
    }
    //console.log("vpath_info=", vpath_info);
    return vpath_info;

}


//------------------------------------------
//-------2-nd PART FIND HOR PATH TO AIM------
//------------------------------------------
function look_edge_line_free(arg)
{
		// arg = {dot_: {id: 1200, xc: 10, yc: 12, left: true}, paths_matr: [[],[]], path_part: [[x1,y1],[x2,y2]] }
		// TODO: don't forget make diff for left and right side
		//let distance = get_distance_from_dot_to_edge();
        let path_tail = (arg.path_part.length > 0) ? (arg.path_part[arg.path_part.length-1]) : ([arg.dot_.xc, arg.dot_.yc]);

		//console.log("lelf: tail=",path_tail);

        let res = {}; // { free: true||false, obstacles: [x2,x3], coord_line: [x1,x2,x3] }
		res.free = true;
		res.obstacles = [];
        res.coord_line = [];

        const YC = path_tail[1], XC = path_tail[0];
        const MATR_W = arg.paths_matr[0].length;

		if (arg.dot_.side == "left")
		{
			for (let x = XC - 1; x >= 0; x--)
            {
				if (arg.paths_matr[YC][x] > 0) {
					res.free = false;
					res.obstacles.push(x);
				}
                let one_coord = [];
                one_coord.push(x, YC);
                res.coord_line.push(one_coord);
			}
		}
		else if (arg.dot_.side == "right")
		{
			// for paths_matr x will except dot coord itself (path coords goes after dot coord) ??
			for (let x = XC + 1; x < MATR_W; x++) {
				if (arg.paths_matr[YC][x] > 0){
					res.free = false;
					res.obstacles.push(x);
				}
                let one_coord = [];
                one_coord.push(x, YC);
                res.coord_line.push(one_coord);
			}
		}
		////console.log("lelf: coord_line =", res.coord_line);
		////console.log("lelf: obstacles =", res.obstacles);
		return res;

}


//-------------------
//--X-------------X--
//---X-----------X---
//--- X---------X----
//-----X-------X-----
//--- X---------X----
//---X-----------X---
//--X-------------X--
//-------------------

// ------------------------------------------
// --------SMALL INDEPENDENT FUNCTIONS-------
// ------------------------------------------
//..............(/(/(
//..........(( °~ ° ))
//...........'(¯`v´¯)
//............(_.^._)
//..............╝'╚
function get_dot_vdir(arg)
{
    // * arg = {}
    let side = arg.dot_.side;
    let vec_vals = arg.pocket.aims_[side][arg.dot_.loc.dest].vec_vals;
    let v_dir = "none"; // * "none" || "up" || "down"

    // * it means that dot located higher than upper boundary of the target, accordingly dot need to move down
    if (vec_vals[0] > arg.dot_.yc) { v_dir = "down"; }////console.log("calc_shift: dot direct down");
    // * it means that dot located lower than the lowest border of aim, so dot need to move up
    else if (vec_vals[vec_vals.length - 1] < arg.dot_.yc) { v_dir = "up"; } ////console.log("calc_shift: dot direct up");

    return v_dir;
}

// ------- CHECK PATH LINES FOR OBSTACLES -----------

function check_path_part_for_obstacles(arg)
{
        // * arg = {path_part: [[x1,y1],[x2,y2]], paths_matr:[[],[]], dot_: {...} }
        let res = {};
        res.arr = [];
        res.is_obstacles = false;
        for (let i in arg.path_part) {
            let xc = arg.path_part[i][0],
                yc = arg.path_part[i][1];

            if (arg.paths_matr[yc][xc] > 0) {
                if (yc == arg.dot_.yc) { res.is_obstacle_on_same_hor_line = true; }
                res.is_obstacles = true;
                let one_obstacle = [];
                one_obstacle.push(xc, yc);
                res.arr.push(one_obstacle)
            }
        }
        return res;
}

function check_vpath_free(arg)
{
    // * arg = {xc: x3, yc_from: y1, yc_to: y5, ord_matr: [[],[]]}
    let vdir =  (arg.yc_from >= arg.yc_to) ? "up" : "down";

    let res = {};
    res.is_free = true;
    res.obstacles = [];

    if (vdir == "down") {
        for (let y = arg.yc_from; y <= arg.yc_to; y++) {
            if (arg.ord_matr[y][arg.xc] > 0) {
                res.is_free = false;
                let one_coord = [];
                one_coord.push(arg.xc, y);
                res.obstacles.push(one_coord);
            }
        }
    }
    else if (vdir == "up") {
        for (let y = arg.yc_from; y >= arg.yc_to; y--) {
            if (arg.ord_matr[y][arg.xc] > 0) {
                res.is_free = false;
                let one_coord = [];
                one_coord.push(arg.xc, y);
                res.obstacles.push(one_coord);
            }
        }
    }
    return res;
}

function check_vpath_free_v2(arg)
{
    // * arg = {xc: x3, yc_from: y1, yc_to: y5, ord_matr: [[],[]]}
    // * we must give a path here to check, excluding the point itself in advance
    let bigger, lower;
    if (arg.yc_from >= arg.yc_to) {bigger = arg.yc_from; lower = arg.yc_to;}
    else { bigger = arg.yc_to; lower = arg.yc_from; }

    let res = {};
    res.is_free = true;
    res.obstacles = [];

    for (let y = lower; y <= bigger; y++) {
        if (arg.ord_matr[y][arg.xc] > 0) {
            res.is_free = false;
            let one_coord = [];
            one_coord.push(arg.xc, y);
            res.obstacles.push(one_coord);
        }
    }
    return res;
}


function check_hpath_free(arg)
{

}
// ------------------------------------------
// --------/SMALL INDEPENDENT FUNCTIONS------
// ------------------------------------------


function find_next_free_aim_smart(arg) {
    let first_next = find_next_free_aim(arg);
    let second_next = find_next_free_aim(arg, first_next);
    if (first_next) {
        if (second_next) {
            //break;
        } else {
            second_next = poss_aim;

            //break;
        }
    }
    else {
    }
    if (arg.dot_.pre_vdir) {
            if ((first_next) && (second_next)) {
                poss_aim = (arg.dot_.pre_vdir == "down") ? (first_next) : (second_next)
            } else if (first_next) {poss_aim = first_next}
        }

}

function find_next_free_aim(arg, smart_prev)
{
        // * arg = { dot_: {}, pocket: {aims_vecs: {left:[], right:[]}, aims_objs: {left:[], right:[]} } }
        let poss_aim = -1;
        //////console.log("fnfa: arg = ",JSON.stringify(arg));
        // * typeof arg.dot_.loc.dest == 'number'
        let pointer = arg.dot_.loc.dest; // e.g. 2
        let counter = 1;
        let sign = -1;
        let s_counter = counter * sign;
        let first_next,
            second_next;
        let side = arg.dot_.side;
        // * this shit iterates throw all aims alternating  2,4,1,5,0,6, i.e. will out of borders, but inside we will check only valid aims
        for (let i = 0; i < arg.pocket.aims_objs[side].length * 2; i++)
        {
            if ( (i % 2 == 0) && (i > 0) ) { counter++; }
            sign = sign * -1; // every loop alternate '+' or '-'
            s_counter = sign * counter;
            poss_aim = arg.dot_.loc.dest + s_counter;
            //console.log("fnfa: i=", i, ", counter=", counter, "s_counter=", s_counter, ", poss_aim=",poss_aim);

            // * possible index falls within the correct range of numbered aims, e.g. if aims count == 3, then from (2,4,1,5,0,6) only (2,1) will passed
            if ( (poss_aim > 0) && (poss_aim <= arg.pocket.aims_objs[side].length) )
            {
                // * if aim not busy yet but already blocked for special set of dots
                if(arg.pocket.aims_[side][poss_aim].not_suitable_for) {
                    //console.log("not_suitable_for=", arg.pocket.aims_[side][poss_aim].not_suitable_for);
                    if ( arg.pocket.aims_[side][poss_aim].not_suitable_for.indexOf(arg.dot_.loc.dest) > - 1 ) {
                        continue; // * jump to next for loop
                    }
                }
                // * string below means that aim is free
                if (arg.pocket.aims_[side][poss_aim].who_join == 0)
                {
                    if (arg.pocket.aims_[side][poss_aim].reserved)
                    {
                        //console.log("RESERVED");
                        if (arg.pocket.aims_[side][poss_aim].reserved.indexOf(arg.dot_.ord) > - 1)
                        {
                            //console.log("ALLOWED");
                            break;
                        }
                    }
                    else
                    {
                       break;
                    }
                    ////console.log("FREE AIM ORD=", arg.pocket.aims_[side][poss_aim].ord);
                }
            }
        }
        if ( (poss_aim <= 0) || (poss_aim > arg.pocket.aims_objs[side].length) ) { return false; }
        else return poss_aim;
}

function check_aim_on_track_busy(arg)
{
        // * arg = {dot_: {...}, pocket: { aims_vecs: {left:[1,1,0,1,1,0,..], right:[]}, aims_objs: {left:[{who_join: 0, ord: 2, vec_vals:[4,5]}, {..} ], right:[]}}
        let busy = true;
        let side_arr = arg.pocket.aims_[arg.dot_.side]; //{1:{},2:{}}
        for (let k in side_arr) {
            if (Number(k) == arg.dot_.loc.dest) {
                //////console.log("side_arr[k]=", side_arr[k]);
                if (side_arr[k].who_join == 0) {
                    // * if exist such array
                    if (side_arr[k].reserved) {
                        // * the array shows who can get here
                        if (side_arr[k].reserved.indexOf(arg.dot_.loc.dest) > -1) {
                            busy = false;
                        }
                    }
                    else {
                        busy = false;
                    }
                }
                break;
            }
        }
        // * res == true or false
        return busy;
}

// * return {rel: "born_on_exit" || "on_track" || "between_tracks" || "under_lowest", dest: <aim ord number>}
function get_dot_pos_rel_aim(arg)
{
    // * arg = { dot_: {xc:5, yc:0,id:1200, side:"left", arrived: false}, pocket: { aims_vecs: {left:[], right:[]}, aims_objs: {left:[{who_join, ord, vec_vals},{..}], right:[{},{}] } }, ord_matr: [[],[]], paths_matr: [[],[]] }
    let res = {};
    // * aims_vec = [1,1,0,1,1,0,...]
	let aims_vec = arg.pocket.aims_vecs[arg.dot_.side];
    // * aims_obj = [{who_join:0, ord: 1, vec_vals:[1,2]},{...}]
	let aims_obj = arg.pocket.aims_objs[arg.dot_.side];
    // * aim_vec_index == 0 || 1
	let aim_vec_index = aims_vec[arg.dot_.yc];

	if (aim_vec_index == 1){
        if (at_very_edge({dot_: arg.dot_, ord_matr: arg.ord_matr})) {
            res.rel = "born_on_exit";
        }
        else {   res.rel = "on_track";   }
		res.dest = collate_aim_ord({dot_yc: arg.dot_.yc, aims_obj: aims_obj});
	}
	else if (aim_vec_index == 0) {
        let lowest = true;
        let is_last_yc = (arg.dot_.yc == aims_vec.length - 1) ? true : false;

        // * if YC is not last and YC+1 has AIM, then it not lowest, but between tracks (between aims)
        if( (!is_last_yc) && (aims_vec[arg.dot_.yc+1] == 1) ) {
            lowest = false;
        }

        if(lowest) {
            res.rel = "under_lowest";
            res.dest = get_last_aim({dot_yc: arg.dot_.yc, aims_obj: aims_obj});
        }
        else {
            res.rel = "between_tracks";
            res.dest = collate_between_aim_ord({ dot_: arg.dot_, aims_obj: aims_obj, paths_matr: arg.paths_matr, ord_matr: arg.ord_matr });
        }
	}
	return res;

    // --- Inner functions ----------------
    function at_very_edge(arg) {
        if ( (arg.dot_.xc == 0) && (arg.dot_.side == "left") ) return true;
        else if ( (arg.dot_.xc == arg.ord_matr[0].length - 1) && (arg.dot_.side == "right") ) return true;
        else return false;
    }

	function collate_aim_ord(arg)
	{
		// arg = {dot_yc: 5, aims_obj: [{who_join: 0, ord: 1, vec_vals:[0,1] }, {..}] }
		let res = 0;
		for (let i=0; i < arg.aims_obj.length; i++) {
			if (arg.aims_obj[i].vec_vals.indexOf(arg.dot_yc) > -1) {
				res = arg.aims_obj[i].ord;
			}
		}
		return res;
	}

	function collate_between_aim_ord(arg)
	{
		// * arg = {dot_: {}, aims_obj: [{who_join, ord, vec_vals},{..}], paths_matr: [[],[]] }
		let res = 0;
        const AIM_H = 2;
        const VOID = 1;
        let is_dots_on_track_above;

        // * check if some dots are exist on track ABOVE or track BELOW in same column ?
        let up_track_vstick = check_vpath_free_v2({yc_from: arg.dot_.yc-1, yc_to:  arg.dot_.yc - AIM_H, xc: arg.dot_.xc, ord_matr: arg.ord_matr});
        let down_track_vstick = check_vpath_free_v2({yc_from: arg.dot_.yc+1, yc_to:  arg.dot_.yc + AIM_H, xc: arg.dot_.xc, ord_matr: arg.ord_matr});

        // * This condition means that YC-1 and YC+1 coords relative dot are busy and dot has clamped top and bottom. And this is bad for us, because it's doing more complexity decision with more elbows and logic
        if ( (!up_track_vstick.is_free)&&(!down_track_vstick.is_free) ) {
            //let is_dot_clamped_top_and_bottom;
            // * in this case we probably will drop away this dot and will judge it on the second pass
            // * TODO: make function which find dest free aim and make tricky overtaking BEHIND dots
            // * this is a temporary solution that just prefers the lower track
            for (let i=0; i < arg.aims_obj.length; i++) {
                if (arg.aims_obj[i].vec_vals.indexOf(arg.dot_.yc+1) > -1) {
				    res = arg.aims_obj[i].ord;
                    break;      }            }
        }
        else if (down_track_vstick.is_free) {
            for (let i=0; i < arg.aims_obj.length; i++) {
                if (arg.aims_obj[i].vec_vals.indexOf(arg.dot_.yc+1) > -1) {
				    res = arg.aims_obj[i].ord;
                    break;                }            }
        }
        else if (up_track_vstick.is_free) {
            for (let i=0; i < arg.aims_obj.length; i++) {
                if (arg.aims_obj[i].vec_vals.indexOf(arg.dot_.yc-1) > -1) {
				    res = arg.aims_obj[i].ord;
                    break;                }            }
        }

		return res;
	}

    function get_last_aim(arg)
	{
		// * arg = {dot_yc: 5, aims_obj: [{who_join, ord, vec_vals},{..}] }
        return arg.aims_obj[arg.aims_obj.length-1].ord;
	}
    // ---------------- Inner functions ---

}

//---------------------------------------------------

function get_dot_pos_rel_grid(arg)
	{
		// arg = { dot_yc: 5, matr_h: 15 }
		if ( arg.dot_yc == 1 ) return "on_y_top"
		else if ( arg.dot_yc == (arg.matr_h) ) return "on_y_bottom"
	}

//------------------------------------

function break_matr_by_lr(arg){
    // * arg = {matr: [ [{}], [{}] ], middle: {min_dist, middle_true, true_k}, id_l: [id1,id3], id_r: [id2,id4]}
    let arr_left = [];
    let some ={};
    return some;
}

function clone_and_sort_objarr(DISTANCE_ARR){
	let dist_arr = DISTANCE_ARR.slice(0);
	dist_arr = dist_arr.sort( (a,b) => {
		if (a.xc < b.xc) return -1;
		if (a.xc > b.xc) return 1;
	});
	return dist_arr;
}

//------------------------------------------------
//------ reshape flat array of objects to 2d ---------
//------and add property 'side' which left or right -------
//------------------------------------------------
//____<"">_____<"">_____...... ____<"">_____<"">_______
/// ___ . __. ___ . __ . ___...\...../ ___ . __. ___ . __ . ___...\...\
//| |__| |...| |__| |....| |__|...|XXX| |__| |...| |__| |....| |__|...|___\
//\____ |__|____ |__|______/.....\____ |__|____ |__|______/___/o
//_O=O____O=O_____O=O_____O=O____O=O____O=O_______
function reshape_2d_and_add_prop_side(DISTANCE_ARR, MATR_W, IDS_L){
    let distarr_reshaped = reshape_2d(DISTANCE_ARR, MATR_W);
    distarr_reshaped = add_props_to_obj_matrix(distarr_reshaped, IDS_L);
    return distarr_reshaped;
}

function reshape_2d(DISTANCE_ARR, MATR_W){
	let t = 0;
	let arr2d = [];
	let div = DISTANCE_ARR.length/MATR_W;
	for (let row = 0; row < div; row++){
		let arr1d = DISTANCE_ARR.slice(t, t+MATR_W);
		t += MATR_W;
		arr2d.push(arr1d.slice(0));
	}
	return arr2d;
}

function add_props_to_obj_matrix(arr2d, IDS_L)
{
    for (let row=0; row < arr2d.length; row++) {
		for (let col=0; col < arr2d[row].length; col++) {
			if (arr2d[row][col].ord){
				if (IDS_L.indexOf(arr2d[row][col].id) > -1) {
                    arr2d[row][col].side = "left";
				} else {
                    arr2d[row][col].side = "right";
                }
			}
		}
	}
    return arr2d;

}
//------------------------------------------------

//.../\__/\
//... |O_O|
//...\___ /
function get_half_array_and_sum(arr, begin, end, MATR_W){
	let res_arr = [];
	let sum = 0;

	for (let i=begin; i<end; i++){

		let val;
		if (begin > 0) { val = MATR_W - arr[i]; }
		else { val = arr[i]; }

		res_arr.push(val);
		sum += val;
	}
	return {arr:res_arr, sum:sum};
}

function get_useful_from_obj(dist_arr){
	let useful = [];
	for (let i in dist_arr){
		if(dist_arr[i].xc > -1) { useful.push(dist_arr[i]) }
	}
	return useful;
}

function get_arr_prop(dist_arr, prop){
	let matr_id = [];
	for (let i in dist_arr) {
		if (dist_arr[i][prop] > -1) {
			matr_id.push(dist_arr[i][prop]);		}	}

	return matr_id;
}

function count_sigma_in_halfs(arg)
{
    // arg = {dist_xcs: DIST_XCS, matr_w: MATR_W, max_aims: MAX_AIMS}
    let result = {};
    // * EXCEPTION BLOCK
    if ( (!arg.dist_xcs) || (arg.dist_xcs.length == 0) ) { result.error = "ARR_X IS NULL OR EMPTY" };
    const IS_OVERDOTS = ( arg.dist_xcs.length - arg.max_aims > 0 ) ? true : false;
    if (IS_OVERDOTS) {
//        //console.log("WAS:",arg.dist_xcs.length);
//        arg.dist_xcs = arg.dist_xcs.slice(0,arg.max_aims);
//        //console.log("BECOME:",arg.dist_xcs.length);
        result.error = "DOTS COUNT MORE THAN AIMS COUNT !"
    };

    // * even or odd count of dots in matrix ?
    const IS_EVEN_ARR = (arg.dist_xcs.length % 2 == 0) ? true: false;

    // * although True middle may be completely different
	const MIDDLE_PROBE = (arg.dist_xcs.length > 1) ? (Math.floor(arg.dist_xcs.length/2)) : 0;

    //const IS_AIMS_ENOUGH = ( arg.dist_xcs.length - arg.max_aims <= 0 ) ? true : false;
    // * for example, (arg.dist_xcs.length == 7) and (arg.max_aims == 10)
    const SHIFT_LIMIT = arg.dist_xcs.length - (arg.max_aims/2); //2
    const LIMIT_LEFT = ( SHIFT_LIMIT > 0 ) ? SHIFT_LIMIT : 0; //2
    const LIMIT_RIGHT = ( SHIFT_LIMIT > 0 ) ? (arg.max_aims/2) : arg.dist_xcs.length; //5
    // * so, if array of all x's length == 7, and max possible aims == 20 then all dots can be even drive out on one side, so then we calc best distance we can make max shift to left or right limit
    ////console.log("csih: LIMIT_LEFT=",LIMIT_LEFT,", LIMIT_RIGHT=",LIMIT_RIGHT);

	let obj = {}, objh = {};
	let min_dist = 0;
	let true_k = 0;
	let middle_true = MIDDLE_PROBE;
	//------------------------------------------
    // * --- COUNT DISTANCE BALANCE IN THE MIDDLE ---
	let sum_l = 0, sum_r = 0, sum_lr = 0;
	// * count left
	for (let i=0; i<MIDDLE_PROBE; i++){ sum_l += Number(arg.dist_xcs[i]); }
	// * count right
	for (let i=MIDDLE_PROBE; i<arg.dist_xcs.length; i++){ sum_r += ( Number(arg.matr_w) - 1 - Number(arg.dist_xcs[i]) ); }
	objh[0] = [sum_l, sum_r];
	obj[0] = sum_l + sum_r;
	min_dist = sum_l + sum_r;

    // * --- END MIDDLE DISTANCE BALANCE---

    //------------------------------------------
    // * ---- MOVING RIGHT to find min Sum of distances
    for (let k=1; k <= (LIMIT_RIGHT - MIDDLE_PROBE); k++)
    {
        sum_l = 0, sum_r = 0, sum_lr = 0;
        // * Sequently INCREASE shifting by 1
        let shift = MIDDLE_PROBE + k; // 4, 5, 6
        ////console.log("shift right:", shift);
        if (shift > LIMIT_RIGHT) { break; } ////console.log("break");
        // * count left
        for (let i=0; i<shift; i++){ sum_l += Number(arg.dist_xcs[i]); }
        // * count right
        for (let i=shift; i<arg.dist_xcs.length; i++){ sum_r += ( Number(arg.matr_w) - 1 - Number(arg.dist_xcs[i]) ); }

        objh[k] = [sum_l, sum_r];
        obj[k] = sum_l + sum_r;
        sum_lr = sum_l + sum_r;

        if (sum_lr<=min_dist) {
            middle_true = MIDDLE_PROBE + Number(k);
            min_dist = sum_lr;
            true_k = k;
        }
        else { break; }
    }
    // * ---- END MOVING RIGHT -----

    //------------------------------------------
    // * ---- MOVING LEFT to find min Sum of distances
    for (let k = -1; k >= ((MIDDLE_PROBE - LIMIT_LEFT) * -1); k--)
    {
        sum_l = 0, sum_r = 0, sum_lr = 0;
        //////console.log("k="+k);
        // * Sequently DECREASE shifting by 1
        let shift = MIDDLE_PROBE + k; // 3, 2, 1
        ////console.log("shift left:", shift);
        if (shift < LIMIT_LEFT) { break; } // (shift == 1) ? break
        // * count left
        for (let i=0; i<shift; i++){ sum_l += Number(arg.dist_xcs[i]); }
        // * count right
        for (let i=shift; i<arg.dist_xcs.length; i++){ sum_r += ( Number(arg.matr_w) - 1 - Number(arg.dist_xcs[i]) ); }

        objh[k] = [sum_l, sum_r];
        obj[k] = sum_l + sum_r;
        sum_lr = sum_l + sum_r;
        if (obj[k]<=min_dist) {
            middle_true = MIDDLE_PROBE + Number(k);
            min_dist = sum_lr;
            true_k = k;
        }
        else { break; }
    }
    // * ---- END MOVING LEFT -----
    result.min_dist = min_dist;
    result.middle_true = middle_true;
    result.even_array = IS_EVEN_ARR;
	return result;
}

function get_distances_array(MATR){
	let matr_id = [];
	let id = 0;
    let ord = 0;
	for (let row in MATR) {
		for (let col in MATR[row]) {
			let obj= {};
			id++;
			obj.id = id;
			if (MATR[row][col] == 1) {
				obj.xc = Number(col);
				obj.yc = Number(row);
                // * a sort of serial number of each dot
                ord++;
                obj.ord = ord;
                obj.arrived = false;
                // the global registry references to dots
                GOB.dots[ord] = obj;
			} else {
				obj.xc = -1;
				obj.yc = -1;
			}
			matr_id.push(obj);

		}
	}
	return matr_id;
}

function countDotsHalfsByLeastSquares(arr2d)
{
	let get_xy_sets_from_matrix = function()
	{
		let x_set, y_set = [];
		const DOT = 1;

		for (let row in arr2d)
		{
			for (let col in arr2d[row])
			{
				if (arr2d[row][col] == DOT ) {
					x_set.push(Number(col)+1);
					y_set.push(Number(row)+1);
				}
			}
		}
		return [x_set, y_set];
	}

	// xy_sets = [ [1,4,2], [6,3,2] ]
	let xy_sets = get_xy_sets_from_matrix();

	const Xi = 0, Yi = 1;
	let lin_coeffs = findLineByLeastSquares(xy_sets[Xi], xy_sets[Yi]);
	////console.log("lin_coeffs = "+lin_coeffs);

	//replace xy_sets indexes
	let lin_coeffs_inv = findLineByLeastSquares(xy_sets[Yi], xy_sets[Xi]);
	////console.log("lin_coeffs_inv = "+lin_coeffs_inv);
}

function countDotsHalfsByCenterParalAxis(arr2d)
{
	let fieldCenter = findFieldCenter(fieldRandomBit);
	////console.log('fieldCenter = '+fieldCenter);
	//center = [float x, float y]
	const CX = center[0];
	const CY = center[1];

	let halfs = {left:[], right:[], up:[],down:[]};
	for (let row in arr2d)
	{
		for (let col in arr2d[row])
		{
			if (arr2d[row][col] >= center[CX] ) {
				halfs.right.push([col, row]);
			} else {
				halfs.left.push([col, row]);
			}
			if (arr2d[row][col] >= center[CY] ) {
				halfs.down.push([col, row]);
			} else {
				halfs.up.push([col, row]);
			}
		}
	}
	return halfs;
}

//________$$$$$
//_______$$___$$
//_______$$___$$
//_______$$___$$
//_______$$___$$
//_______$$___$$
//_______$$___$$$$$$
//_______$$___$$___$$$$$$
//_______$$___$$___$$____$$$$
//_______$$___$$___$$____$__$$
//_$$$$$_$$___$$___$$___$$____$
//_$$____$$$_____________$____$
//_$$____$$___________________$
//__$$___$$___________________$
//___$$__$$___________________$
//____$$______________________$
//_____$$___________________$$$
//______$$$_________________$$
//_______$$_________________$$
//_______$$$_______________$$
//_________$$_____________$$
//_________$$$$$$$$$$$$$$$$$
//_________$$$$$$$$$$$$$$$$$

function findFieldCenter(field) {
	let sum_x = 0, count = 0;
	for (let y in field) {
		for (let x in field[y]) {
			if (field[y][x] == 1) 	{
				sum_x += (Number(x)+1);
				count++;	}	}	}
	return sum_x/count;
}

function printArr(arr2d){
	let str = "";
	for (let i=0; i < arr2d.length; i++) {
			//////console.log(arr2d[i].join(" "));
			str += arr2d[i].join(" ");
			str += "\r\n";
	}
	return str;
}

function printArrObj(arrobj){
	let str = "";
	for (let i in arrobj) {
			//////console.log(arr2d[i].join(" "));
			str += JSON.stringify(arrobj[i]);
			str += "\r\n";
	}
	return str;
}

function printArr2dObj(arr2d){
	let str = "";
	for (let i=0; i < arr2d.length; i++) {
		for (let j=0; j < arr2d[i].length; j++) {
			str += JSON.stringify(arr2d[i][j]);
			str += ", "
		}
		str += "\r\n";
	}
	return str;
	//fs.writeFileSync("arr2dobj.txt", str);
}

function ArrToStr(arr2d){
	let str="";
	for (let i=0; i < arr2d.length; i++) {
			str += ("r\n"+i+"\r\n");
			str += arr2d[i].join(" ");
	}
	return str;
}

// returns random filled matrix, with 0 and 1 values
function getFieldRandomBit(shape)
{
    if ( (!shape) || (shape.length == 0) ) return {error:"shape length must be > 0."};
    const CELLS_CNT = (shape.length > 1) ? (shape[0] * shape[1]) : shape[0];
    const RANDOM_KOEFF = (CELLS_CNT<400) ? 0.45 : 0.488;
    ////console.log("RANDOM_KOEFF =", RANDOM_KOEFF);
    //const RANDOM_KOEFF = 0.488;
	//shape = [2,4] really cool
	let getVectorBit = function(len) {
		let res = [];
		for (let i=0; i < len; i++) { res.push(Math.round(Math.random()-RANDOM_KOEFF)) }
		return res;
	}
	if (shape.length == 1)
	{
		let arrBit = [];
		arrBit.push(getVectorBit(shape[0]));
		//fs.writeFileSync("ArrBit.txt", ArrToStr(arrBit));
		return arrBit;
	}
	else if (shape.length > 1)
	{
		let arrBit = [];
		for (let i=0; i < shape[0]; i++) { arrBit.push(getVectorBit(shape[1])) }
		//fs.writeFileSync("ArrBit.txt", ArrToStr(arrBit));
		//////console.log(ArrToStr(arrBit));
		return arrBit;
	}

}

//
function findLineByLeastSquares(values_x, values_y)
{
    var sum_x = 0;
    var sum_y = 0;
    var sum_xy = 0;
    var sum_xx = 0;
    var count = 0;

    if (values_x.length != values_y.length) {
        throw new Error('The parameters values_x and values_y need to have same size!');
    }

    // Nothing to do.
    if (values_x.length === 0) { return [ [], [] ]; }

    // Calculate the sum for each of the parts necessary.
    for (var v = 0; v < values_x.length; v++) {
        let x = values_x[v];
        let y = values_y[v];
        sum_x += x;
        sum_y += y;
        sum_xx += x*x;
        sum_xy += x*y;
        count++;
    }

    // Calculate m and b for the formular:
    // y = x * a + b
    var a = (count*sum_xy - sum_x*sum_y) / (count*sum_xx - sum_x*sum_x);
    var b = (sum_y/count) - (a*sum_x)/count;

    return [a, b];
}

//---------------------------------------
//-----------USEFULL FUNCTIONS-----------
//---------------------------------------

function DiffArrays(A,B)
{
    var M = A.length, N = B.length, c = 0, C = [];
    for (var i = 0; i < M; i++)
     { var j = 0, k = 0;
       while (B[j] !== A[ i ] && j < N) j++;
       while (C[k] !== A[ i ] && k < c) k++;
       if (j == N && k == c) C[c++] = A[ i ];
     }
   return C;
}

//__¶8_________¶¶_____________________________8
//_¶¶¶8_______¶¶¶______________________8¶¶¶¶¶¶8
//_¶__¶¶¶___8¶¶_¶¶_________________8¶¶_¶¶¶¶_¶¶¶
//_¶__8_¶8__¶¶_8_¶_______________8¶¶¶_8¶¶___¶8
//_¶__¶¶¶¶_¶¶_¶¶_¶¶_____________8¶¶¶__¶¶___¶¶
//_¶8_¶_¶¶¶¶_¶¶¶¶¶¶____________¶¶¶¶___¶____¶
//_¶¶_¶_¶_¶¶_¶_¶¶¶¶___________¶¶_¶¶___¶____8
//__¶8¶¶8_¶¶¶¶_¶_¶¶__________¶¶¶_¶¶___¶___88
//___8¶_¶¶¶¶¶¶¶¶¶¶__________¶¶¶¶_¶¶¶_______¶
//____¶¶8_______¶8__________¶_¶¶___________¶
//___¶8__________¶¶________8¶__¶___________¶¶
//__¶¶____________¶________8¶__¶____________¶¶
//_¶8_____8_______8¶¶_______¶________________¶¶
//_¶____8¶¶¶_______¶¶8______¶_________________¶¶
//_¶____¶__¶_______8¶¶¶¶¶¶¶8¶8________________8¶¶
//_¶__¶¶¶¶¶¶_______¶¶____¶¶¶¶8¶¶¶¶8_____________¶8
//_¶__¶8¶¶¶________¶¶____________¶¶¶¶___________¶¶
//_¶__¶¶¶¶¶_______¶¶_______________8¶8___________¶¶
//_¶8__8___¶__¶__8¶_________________8¶¶___________¶¶
//_¶¶¶¶¶¶¶¶¶8__8¶¶¶___________________¶¶__________¶¶
//___¶¶¶¶_¶¶_8¶¶¶¶_____________________¶¶_________¶¶
//___8¶¶¶¶¶8¶¶¶¶¶8______________________¶8________¶¶
//____¶¶¶1¶8¶_¶¶_________8¶______________¶¶_______¶¶
//____¶11¶¶¶_____________¶¶_______________88______¶¶
//____¶11¶¶¶¶¶¶¶________¶¶________________¶¶_____¶¶
//____¶111¶8¶¶¶¶¶8¶¶¶¶¶¶¶__________________¶____¶¶¶
//____¶11111111¶¶¶_____¶___________________¶____¶
//____¶¶1111118¶_¶¶___8¶___________________¶__8¶¶
//_____¶¶1111¶¶___¶____8___________________¶¶_¶¶
//______¶8¶¶¶__¶¶_¶¶¶__¶¶__________________¶8¶¶
//______________¶¶__¶¶__¶¶_________________¶¶
//_______________¶¶__¶¶__¶¶_______________¶¶
//______________¶¶¶¶¶¶¶¶¶¶¶¶___________8¶8¶
//_____________¶e8¶_______¶h¶8________¶¶¶
//_____________¶8¶8_____¶¶¶_8¶¶8¶¶8¶¶¶8
//______________8¶8¶¶¶¶¶8¶¶¶__8¶¶8¶¶8
//_______________________8¶8¶8¶¶8
//
//---------------------------------------

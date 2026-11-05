import { jsx, fragment, type child } from "../vnode.tsx"
import { raw } from "../markup.tsx"
export function window_svg_edit(): child {
    return (
        <>
            <div class={"desk_wbox_body_wysg"}>
                <div class={"desk_wbox_body_wysg_stage"}>
                    <div class={"desk_wbox_body_wysg_view"}>
                        <span class={"desk_wbox_body_wysg_label"}>{"viewBox 0 0 640 360"}</span>
                        <svg
                            class={"desk_wbox_body_wysg_art"}
                            xmlns={"http://www.w3.org/2000/svg"}
                            viewBox={"0 0 640 360"}
                            role={"img"}
                            aria-label={"Canvas"}
                        >
                            <rect
                                class={"shape"}
                                x={"40"}
                                y={"40"}
                                width={"130"}
                                height={"90"}
                                rx={"8"}
                            ></rect>
                            <text class={"shape_text"} x={"105"} y={"91"} text-anchor={"middle"}>
                                {"Input"}
                            </text>
                            <ellipse
                                class={"shape shape_hi"}
                                cx={"540"}
                                cy={"100"}
                                rx={"70"}
                                ry={"50"}
                            ></ellipse>
                            <rect class={"shape"} x={"200"} y={"90"} width={"240"} height={"140"}></rect>
                            <text class={"shape_text"} x={"320"} y={"165"} text-anchor={"middle"}>
                                {"Selected"}
                            </text>
                            <path
                                class={"shape shape_line"}
                                d={"M60 310 C160 230 260 350 360 280 S520 260 590 310"}
                            ></path>
                            <g class={"node_layer"}>
                                <line class={"node_arm"} x1={"60"} y1={"310"} x2={"160"} y2={"230"}></line>
                                <line class={"node_arm"} x1={"360"} y1={"280"} x2={"260"} y2={"350"}></line>
                                <line class={"node_arm"} x1={"360"} y1={"280"} x2={"460"} y2={"210"}></line>
                                <circle class={"node_ctrl"} cx={"160"} cy={"230"} r={"4"}></circle>
                                <circle class={"node_ctrl"} cx={"260"} cy={"350"} r={"4"}></circle>
                                <circle class={"node_ctrl"} cx={"460"} cy={"210"} r={"4"}></circle>
                                <rect class={"node"} x={"55"} y={"305"} width={"10"} height={"10"}></rect>
                                <rect
                                    class={"node node_on"}
                                    x={"355"}
                                    y={"275"}
                                    width={"10"}
                                    height={"10"}
                                ></rect>
                                <rect class={"node"} x={"585"} y={"305"} width={"10"} height={"10"}></rect>
                            </g>
                        </svg>
                        <div
                            class={"desk_wbox_body_wysg_hover"}
                            style={"--x:470;--y:50;--w:140;--h:100"}
                        ></div>
                        <div class={"desk_wbox_body_wysg_sel"} style={"--x:200;--y:90;--w:240;--h:140"}>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_nw"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_n"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_ne"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_e"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_se"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_s"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_sw"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_w"}></i>
                            <i class={"desk_wbox_body_wysg_dot desk_wbox_body_wysg_dot_rot"}></i>
                            <span class={"desk_wbox_body_wysg_size"}>{"240 × 140"}</span>
                        </div>
                    </div>
                </div>
                <div class={"desk_wbox_body_wysg_tool"} role={"toolbar"} aria-label={"SVG tools"}>
                    <div class={"desk_wbox_body_wysg_tool_group"} role={"group"} aria-label={"Clipboard"}>
                        <div class={"desk_wbox_body_wysg_tool_box"}>
                            <button type={"button"} title={"Cut"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Cut"}
                            </button>
                            <button type={"button"} title={"Copy"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Copy"}
                            </button>
                            <button type={"button"} title={"Paste"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Paste"}
                            </button>
                            <button type={"button"} title={"Delete"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Delete"}
                            </button>
                        </div>
                        <span class={"desk_wbox_body_wysg_tool_name"} aria-hidden={"true"}>
                            {"Clipboard"}
                        </span>
                    </div>
                    <div class={"desk_wbox_body_wysg_tool_group"} role={"group"} aria-label={"History"}>
                        <div class={"desk_wbox_body_wysg_tool_box"}>
                            <button type={"button"} title={"Undo"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Undo"}
                            </button>
                            <button type={"button"} title={"Redo"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Redo"}
                            </button>
                        </div>
                        <span class={"desk_wbox_body_wysg_tool_name"} aria-hidden={"true"}>
                            {"History"}
                        </span>
                    </div>
                    <div class={"desk_wbox_body_wysg_tool_group"} role={"group"} aria-label={"Create"}>
                        <div class={"desk_wbox_body_wysg_tool_box"}>
                            <details class={"desk_wbox_body_wysg_tool_more"} name={"svg_more"}>
                                <summary title={"Shape"} aria-label={"Shape"}>
                                    <span aria-hidden={"true"}>{""}</span>
                                    {"Shape"}
                                </summary>
                                <span class={"desk_wbox_body_wysg_tool_sub"}>
                                    <button type={"button"} title={"Rectangle"}>
                                        <span aria-hidden={"true"}>{""}</span>
                                        {"Rect"}
                                    </button>
                                    <button type={"button"} title={"Ellipse"}>
                                        <span aria-hidden={"true"}>{""}</span>
                                        {"Ellipse"}
                                    </button>
                                    <button type={"button"} title={"Line"}>
                                        <span aria-hidden={"true"}>{""}</span>
                                        {"Line"}
                                    </button>
                                    <button type={"button"} title={"Polygon"}>
                                        <span aria-hidden={"true"}>{""}</span>
                                        {"Polygon"}
                                    </button>
                                    <button type={"button"} title={"Star"}>
                                        <span aria-hidden={"true"}>{""}</span>
                                        {"Star"}
                                    </button>
                                </span>
                            </details>
                            <button type={"button"} title={"Text"} aria-pressed={"false"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Text"}
                            </button>
                            <button type={"button"} title={"Pen"} aria-pressed={"false"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Pen"}
                            </button>
                            <button type={"button"} title={"Image"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Image"}
                            </button>
                            <button type={"button"} title={"New box or slide"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"New box"}
                            </button>
                        </div>
                        <span class={"desk_wbox_body_wysg_tool_name"} aria-hidden={"true"}>
                            {"Create"}
                        </span>
                    </div>
                    <div class={"desk_wbox_body_wysg_tool_group"} role={"group"} aria-label={"Arrange"}>
                        <div class={"desk_wbox_body_wysg_tool_box"}>
                            <button type={"button"} title={"Bring forward"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Forward"}
                            </button>
                            <button type={"button"} title={"Send backward"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Backward"}
                            </button>
                            <button type={"button"} title={"Group"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Group"}
                            </button>
                            <button type={"button"} title={"Ungroup"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Ungroup"}
                            </button>
                        </div>
                        <span class={"desk_wbox_body_wysg_tool_name"} aria-hidden={"true"}>
                            {"Arrange"}
                        </span>
                    </div>
                    <div class={"desk_wbox_body_wysg_tool_group"} role={"group"} aria-label={"Combine"}>
                        <div class={"desk_wbox_body_wysg_tool_box"}>
                            <button type={"button"} title={"Union"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Union"}
                            </button>
                            <button type={"button"} title={"Subtract"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Subtract"}
                            </button>
                            <button type={"button"} title={"Intersect"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Intersect"}
                            </button>
                        </div>
                        <span class={"desk_wbox_body_wysg_tool_name"} aria-hidden={"true"}>
                            {"Combine"}
                        </span>
                    </div>
                    <div class={"desk_wbox_body_wysg_tool_group"} role={"group"} aria-label={"View"}>
                        <div class={"desk_wbox_body_wysg_tool_box"}>
                            <button type={"button"} title={"Zoom out"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Zoom out"}
                            </button>
                            <button type={"button"} title={"Fit viewBox to window"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Fit"}
                            </button>
                            <button type={"button"} title={"Zoom in"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Zoom in"}
                            </button>
                            <button type={"button"} title={"Grid"} aria-pressed={"false"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Grid"}
                            </button>
                            <button type={"button"} title={"Snap"} aria-pressed={"true"}>
                                <span aria-hidden={"true"}>{""}</span>
                                {"Snap"}
                            </button>
                        </div>
                        <span class={"desk_wbox_body_wysg_tool_name"} aria-hidden={"true"}>
                            {"View"}
                        </span>
                    </div>
                </div>
            </div>
        </>
    )
}

####

p4aio
###################################

registers DL teid, forwarding/encapsulating/decaspulation functions

###################################################################################### ####################################################################################### ###################################################################################### #################rules #################

allow flow gnb (192.168.40.220) to UPF (192.168.10.133)
table_add ipv4_match to_port_action 192.168.40.220/32 => 0 table_add ipv4_match to_port_action_OUT2 192.168.10.133/32 => 1

register all DL teids direction to gnb
table_add registerteid register_teid 192.168.40.220/32 =>

apply encap/decap rules to Application server (192.168.50.80)
table_add ipv4_match_encap gtp_encapsulate 192.168.50.80/32 => 0 table_add ipv4_match_decap gtp_decapsulate 192.168.50.80/32 => 2

###################################################################################### ######################################################################################

#include <core.p4>
#include <v1model.p4>

typedef bit<48> EthernetAddress;
typedef bit<32> IPv4Address;

const bit<8>  IPPROTO_UDP   = 0x11;

const bit<48> OUT_MAC_SRC1 =  0x0242be9b9f34;
const bit<48> OUT_MAC_DST1 =  0x0242ac120002;
const bit<48> OUT_MAC_SRC2 =  0x0242948b3ef2;
const bit<48> OUT_MAC_DST2 =  0x0242ac130002;
const bit<48> OUT_MAC_SRC3 =  0x024244ef9fcf;
const bit<48> OUT_MAC_DST3 =  0x0242ac140002;
const bit<16> GTP_UDP_PORT     = 2152;

/*************************************************************************
*********************** H E A D E R S  ***********************************
*************************************************************************/

header ethernet_t {
    EthernetAddress dst_addr;
    EthernetAddress src_addr;
    bit<16>         ether_type;
}

header ipv4_t {
    bit<4>      version;
    bit<4>      ihl;
    bit<8>      diffserv;
    bit<16>     total_len;
    bit<16>     identification;
    bit<3>      flags;
    bit<13>     frag_offset;
    bit<8>      ttl;
    bit<8>      protocol;
    bit<16>     hdr_checksum;
    IPv4Address src_addr;
    IPv4Address dst_addr;
}

header gtp_common_t {
	bit<3> version; /* this should be 1 for GTPv1 and 2 for GTPv2 */
	bit<1> pFlag;   /* protocolType for GTPv1 and pFlag for GTPv2 */
	bit<1> tFlag;   /* only used by GTPv2 - teid flag */
	bit<1> eFlag;   /* only used by GTPv1 - E flag */
	bit<1> sFlag;   /* only used by GTPv1 - S flag */
	bit<1> pnFlag;  /* only used by GTPv1 - PN flag */
	bit<8> messageType;
	bit<16> messageLength;
}
header gtp_teid_t {
	bit<32> teid;
	bit<16> sNumber;
	bit<8> pnNumber;
	bit<8> nextExtHdrType;
        bit<8> plength; /* length in 4-octet units */
        bit<4> pdu_type;
        bit<4> spare1;
        bit<2> spare2;
        bit<6> qfi;
        bit<8> nextExtHdrType1;

}

/* Extension header if E flag is on. */

header gtpv1_extension_hdr_t {
	bit<8> plength; /* length in 4-octet units */
        bit<4> pdu_type;
        bit<4> spare1;
        bit<2> spare2;
        bit<6> qfi; 
	bit<8> nextExtHdrType;
}


/* GPRS Tunnelling Protocol (GTP) v2 (also known as evolved-GTP or eGTP) */


header gtpv2_ending_t {
	bit<24> sNumber;
	bit<8> reserved;
}

header udp_t {
    bit<16> srcPort;
    bit<16> dstPort;
    bit<16> plength;
    bit<16> checksum;
    
}
header tcp_t {
    bit<16> srcPort;
    bit<16> dstPort;
    bit<32> seqNo;
    bit<32> ackNo;
    bit<4>  dataOffset;
    bit<4>  res;
    bit<8>  flags;
    bit<16> window;
    bit<16> checksum;
    bit<16> urgentPtr;
}
struct headers_t {
    ethernet_t ethernet;
    ipv4_t     ipv4;
    ipv4_t     inner_ipv4;
    gtp_common_t gtp_common;
    gtp_teid_t gtp_teid;
    gtpv1_extension_hdr_t gtpv1_extension_hdr;
    gtpv2_ending_t gtpv2_ending;
    udp_t udp;
    udp_t inner_udp;	
    tcp_t tcp;
    tcp_t inner_tcp;
}

struct metadata_t {
}

error {
    IPv4IncorrectVersion,
    IPv4OptionsNotSupported
}

/*************************************************************************
*********************** P A R S E R  ***********************************
*************************************************************************/

parser my_parser(packet_in packet,
                out headers_t hd,
                inout metadata_t meta,
                inout standard_metadata_t standard_meta)
{
    state start {
        packet.extract(hd.ethernet);
        transition select(hd.ethernet.ether_type) {
            0x0800:  parse_ipv4;
            default: accept;
        }
    }

    state parse_ipv4 {
        packet.extract(hd.ipv4);
        transition select(hd.ipv4.protocol){
	    IPPROTO_UDP  : parse_udp;
            default      : accept;     
		}
    } 
    state parse_udp {
        packet.extract(hd.udp);
        transition select(hd.udp.dstPort) {
            GTP_UDP_PORT : parse_gtp;
            default      : accept;    
        }
    }
	state parse_gtp {
        packet.extract(hd.gtp_common);
        transition select(hd.gtp_common.version) {
		    1 : parse_teid;
		    2 : parse_gtpv2;
		    default : accept;
	    }
    }
	state parse_teid {
        packet.extract(hd.gtp_teid);
        transition parse_inner;
    }
 
    state parse_gtpv2 {
        packet.extract(hd.gtpv2_ending);
        transition accept;
    }

    state parse_gtpv1_extension_hdr {
       packet.extract(hd.gtpv1_extension_hdr);
       transition parse_inner;   
    }

    state parse_inner {
        packet.extract(hd.inner_ipv4);
        transition accept;
    }
}
/*************************************************************************
***********************  D E P A R S E R  *******************************
*************************************************************************/

control my_deparser(packet_out packet,
                   in headers_t hdr)
{
    apply {
        packet.emit(hdr.ethernet);
        packet.emit(hdr.ipv4);
        packet.emit(hdr.udp);
        packet.emit(hdr.gtp_common);
        packet.emit(hdr.gtp_teid);
        packet.emit(hdr.inner_ipv4);
	packet.emit(hdr.inner_udp);
        packet.emit(hdr.inner_tcp);
		
    }
}

/*************************************************************************
************   C H E C K S U M    V E R I F I C A T I O N   *************
*************************************************************************/

control my_verify_checksum(inout headers_t hdr,
                         inout metadata_t meta)
{
    apply { }
}

control Ipv4ComputeChecksum(inout headers_t  hdr, inout metadata_t meta) {
     apply {
      update_checksum(
            hdr.ipv4.isValid(),
            { hdr.ipv4.version,
              hdr.ipv4.ihl,
              hdr.ipv4.diffserv,
              hdr.ipv4.total_len,
              hdr.ipv4.identification,
              hdr.ipv4.flags,
              hdr.ipv4.frag_offset,
              hdr.ipv4.ttl,
              hdr.ipv4.protocol,
              hdr.ipv4.src_addr,
              hdr.ipv4.dst_addr },
            hdr.ipv4.hdr_checksum,
            HashAlgorithm.csum16);
    }
}


/*************************************************************************
**************  I N G R E S S   P R O C E S S I N G   *******************
*************************************************************************/

control my_ingress(inout headers_t hdr,
                  inout metadata_t meta,
                  inout standard_metadata_t standard_metadata)
{
    bool dropped = false;

    action drop_action() {
        mark_to_drop(standard_metadata);
        dropped = true;
    }

    action to_port_action(bit<9> port) {
        hdr.ipv4.ttl = hdr.ipv4.ttl - 1;
        hdr.ethernet.src_addr = OUT_MAC_SRC1;
        hdr.ethernet.dst_addr = OUT_MAC_DST1;
        standard_metadata.egress_spec = port;
    }
    action to_port_action_OUT2(bit<9> port) {
        hdr.ipv4.ttl = hdr.ipv4.ttl - 1;
        hdr.ethernet.src_addr = OUT_MAC_SRC2;
        hdr.ethernet.dst_addr = OUT_MAC_DST2;
        standard_metadata.egress_spec = port;
    }
    action to_port_action_OUT3(bit<9> port) {
        hdr.ipv4.ttl = hdr.ipv4.ttl - 1;
        hdr.ethernet.src_addr = OUT_MAC_SRC3;
        hdr.ethernet.dst_addr = OUT_MAC_DST3;
        standard_metadata.egress_spec = port;
    }

 
   table ipv4_match {
        key = {
            hdr.ipv4.dst_addr: lpm;
        }
        actions = {
            drop_action;
            to_port_action;
            to_port_action_OUT2;
            to_port_action_OUT3;
        }
        size = 1024;
        default_action = drop_action;
   }
   
  table teid_match {
        key = {
            hdr.gtp_teid.teid: exact;
        }
        actions = {
#            drop_action;
            to_port_action;
            to_port_action_OUT2;
            to_port_action_OUT3;
        }
        size = 1024;
#        default_action = drop_action;
   }

    
    apply {
        ipv4_match.apply();
        teid_match.apply();
        if (dropped) return;
    }
}

control my_egress(inout headers_t hdr,
                 inout metadata_t meta,
                 inout standard_metadata_t standard_metadata)
{
    apply { }
}


V1Switch(my_parser(),
         my_verify_checksum(),
         my_ingress(),
         my_egress(),
         Ipv4ComputeChecksum(),
         my_deparser()) main;
